// 文書ライブラリのファイルの保存・読み出し（サーバ専用）。
//
// ファイル本体は Storage の documents バケット（非公開。authenticated 向けのポリシーなし）に置き、
// ブラウザからは直接読めない。アップロードもダウンロードも、ここでロールと公開範囲を確かめてから service_role で行う。
// 形式は先頭のバイトで判定する（ブラウザが付けた種類・拡張子は信じない）。

import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CurrentProfile } from '@/lib/currentProfile';
import { detectFileMimeType } from '@/lib/files/fileSignature';
import { DOCUMENT_CATEGORIES, DOCUMENT_VISIBILITIES } from '@/lib/resources/definitions';
import { isUuid, parseFieldValue, type FieldDef } from '@/lib/resources/fields';
import { recordAudit, type WriteResult } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isInternal } from '@/types/role';

export const DOCUMENTS_BUCKET = 'documents';
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
/** ダウンロード用の署名つき URL の有効期間（秒） */
export const DOWNLOAD_URL_TTL_SECONDS = 120;

export const DOCUMENT_COLUMNS =
  'id, title, category, description, documentDate, fileName, mimeType, sizeBytes, sha256, visibility, entityType, entityId, uploadedByUserId, createdAt, updatedAt';

export interface DocumentRow {
  id: string;
  title: string;
  category: string;
  description: string;
  documentDate: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  visibility: 'internal' | 'shareholders' | 'restricted';
  entityType: string | null;
  entityId: string | null;
  uploadedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 関連づけられるレコードの種類（entityType）。画面のリンク先を決めるのに使う */
export const DOCUMENT_ENTITY_TYPES = [
  'meeting',
  'financial_report',
  'shareholder_update',
  'funding_round',
  'option_plan',
  'convertible_round',
  'stakeholder',
] as const;

const OFFICE_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/csv': 'csv',
  ...Object.fromEntries(Object.entries(OFFICE_TYPES).map(([extension, mime]) => [mime, extension])),
};

/** 受け付ける形式なら MIME タイプを返す。PDF・画像は中身で、Office 文書は ZIP の署名と拡張子で、文字は中身が文字として読めるかで判定する */
export const detectDocumentType = (data: Uint8Array, fileName: string): string | null => {
  const detected = detectFileMimeType(data);
  if (detected) return detected;
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  const isZip = data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  if (isZip && OFFICE_TYPES[extension]) return OFFICE_TYPES[extension];
  if (extension === 'txt' || extension === 'csv') {
    // NUL を含むものは文字のファイルとして扱わない
    if (!data.subarray(0, 4096).includes(0)) return extension === 'csv' ? 'text/csv' : 'text/plain';
  }
  return null;
};

// 中身から決めた形式に合う拡張子（同じ形式として扱う別名も含む）
const ACCEPTED_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
};

/**
 * ファイル名の拡張子を、中身から決めた形式に合わせる。合っていなければ、正しい拡張子を後ろに足す。
 * 形式は中身で判定しているので、名前だけを「請求書.pdf.bat」「案内.html」のようにしたファイルを保存できてしまう。
 * その名前のままダウンロードさせると、受け取った人（株主・共有リンクの相手）の端末で、別の種類のファイルとして開かれる。
 */
export const withMatchingExtension = (fileName: string, mimeType: string): string => {
  const expected = EXTENSIONS[mimeType];
  if (!expected) return fileName;
  const current = fileName.includes('.') ? (fileName.toLowerCase().split('.').pop() ?? '') : '';
  const accepted = ACCEPTED_EXTENSIONS[mimeType] ?? [expected];
  return accepted.includes(current) ? fileName : `${fileName}.${expected}`;
};

const METADATA_FIELDS: FieldDef[] = [
  { key: 'title', label: 'タイトル', type: 'text', required: true, maxLength: 200 },
  { key: 'category', label: '分類', type: 'select', options: DOCUMENT_CATEGORIES, required: true },
  { key: 'description', label: '説明', type: 'textarea', maxLength: 4000 },
  { key: 'documentDate', label: '文書の日付', type: 'date' },
  { key: 'visibility', label: '公開範囲', type: 'select', options: DOCUMENT_VISIBILITIES, required: true },
];

type Actor = Pick<CurrentProfile, 'id' | 'organizationId'>;

const parseMetadata = (raw: Record<string, unknown>): WriteResult<Record<string, string | number | boolean | null>> => {
  const values: Record<string, string | number | boolean | null> = {};
  const fieldErrors: Record<string, string> = {};
  for (const field of METADATA_FIELDS) {
    const parsed = parseFieldValue(field, raw[field.key]);
    if (parsed.ok) values[field.key] = parsed.value;
    else fieldErrors[field.key] = parsed.error;
  }
  const first = Object.values(fieldErrors)[0];
  return first ? { ok: false, status: 400, error: first, fieldErrors } : { ok: true, data: values };
};

export interface UploadInput {
  fileName: string;
  data: Uint8Array;
  title?: string;
  category?: string;
  description?: string;
  documentDate?: string;
  visibility?: string;
  entityType?: string | null;
  entityId?: string | null;
}

/** ファイルを保存して documents に 1 行足す。呼び出し側が requireEditor を通してから呼ぶ */
export const uploadDocument = async (
  actor: Actor,
  input: UploadInput,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<DocumentRow>> => {
  if (input.data.byteLength === 0) return { ok: false, status: 400, error: 'ファイルが空です' };
  if (input.data.byteLength > MAX_DOCUMENT_BYTES) return { ok: false, status: 400, error: 'ファイルは 20MB までです' };
  const mimeType = detectDocumentType(input.data, input.fileName);
  if (!mimeType) {
    return { ok: false, status: 400, error: '保存できるのは PDF、画像（PNG・JPEG・WebP）、Word・Excel・PowerPoint、テキスト・CSV のファイルです' };
  }
  // パスの区切りと制御文字を落とす（表示とダウンロード時のファイル名に使うため）
  const fileName = withMatchingExtension(
    Array.from(input.fileName)
      .map((char) => (char === '/' || char === '\\' || char.charCodeAt(0) < 0x20 ? '_' : char))
      .join('')
      .slice(-250) || 'file',
    mimeType,
  );
  const metadata = parseMetadata({
    title: input.title?.trim() || fileName.replace(/\.[^.]+$/, ''),
    category: input.category || 'other',
    description: input.description ?? '',
    documentDate: input.documentDate ?? '',
    visibility: input.visibility || 'internal',
  });
  if (!metadata.ok) return metadata;

  const entityType = input.entityType && (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(input.entityType) ? input.entityType : null;
  const entityId = entityType && isUuid(input.entityId) ? input.entityId : null;

  const id = randomUUID();
  const storagePath = `${actor.organizationId}/${id}.${EXTENSIONS[mimeType] ?? 'bin'}`;
  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, input.data, { contentType: mimeType, upsert: false });
  if (uploadError) return { ok: false, status: 500, error: 'ファイルの保存に失敗しました' };

  const { data, error } = await admin
    .from('documents')
    .insert({
      id,
      organizationId: actor.organizationId,
      ...metadata.data,
      storagePath,
      fileName,
      mimeType,
      sizeBytes: input.data.byteLength,
      sha256: createHash('sha256').update(input.data).digest('hex'),
      entityType,
      entityId: entityType ? entityId : null,
      uploadedByUserId: actor.id,
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error || !data) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    return { ok: false, status: 500, error: '文書の登録に失敗しました' };
  }
  const row = data as unknown as DocumentRow;
  await recordAudit(admin, actor, 'documents.create', 'documents', row.id, { title: row.title, sha256: row.sha256 });
  return { ok: true, data: row };
};

export const listDocuments = async (
  organizationId: string,
  filters: { category?: string; entityType?: string; entityId?: string } = {},
  admin: SupabaseClient = createAdminClient(),
): Promise<DocumentRow[]> => {
  let query = admin.from('documents').select(DOCUMENT_COLUMNS).eq('organizationId', organizationId);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.entityType) query = query.eq('entityType', filters.entityType);
  if (filters.entityId) {
    if (!isUuid(filters.entityId)) return [];
    query = query.eq('entityId', filters.entityId);
  }
  const { data, error } = await query.order('createdAt', { ascending: false }).limit(2000);
  if (error) throw new Error('文書の取得に失敗しました');
  return (data ?? []) as unknown as DocumentRow[];
};

export const updateDocument = async (
  actor: Actor,
  id: string,
  raw: unknown,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<DocumentRow>> => {
  if (!isUuid(id) || !raw || typeof raw !== 'object') return { ok: false, status: 404, error: '文書が見つかりません' };
  const metadata = parseMetadata(raw as Record<string, unknown>);
  if (!metadata.ok) return metadata;
  const { data, error } = await admin
    .from('documents')
    .update(metadata.data)
    .eq('organizationId', actor.organizationId)
    .eq('id', id)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: '文書の保存に失敗しました' };
  if (!data) return { ok: false, status: 404, error: '文書が見つかりません' };
  const row = data as unknown as DocumentRow;
  await recordAudit(admin, actor, 'documents.update', 'documents', id, { title: row.title, visibility: row.visibility });
  return { ok: true, data: row };
};

export const deleteDocument = async (
  actor: Actor,
  id: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<{ id: string }>> => {
  if (!isUuid(id)) return { ok: false, status: 404, error: '文書が見つかりません' };
  const { data, error } = await admin
    .from('documents')
    .delete()
    .eq('organizationId', actor.organizationId)
    .eq('id', id)
    .select('id, title, storagePath')
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: '文書の削除に失敗しました' };
  if (!data) return { ok: false, status: 404, error: '文書が見つかりません' };
  const row = data as { id: string; title: string; storagePath: string };
  // 行を消したあとにファイルを消す（失敗してもファイルが残るだけで、画面からは辿れない）
  await admin.storage.from(DOCUMENTS_BUCKET).remove([row.storagePath]);
  await recordAudit(admin, actor, 'documents.delete', 'documents', id, { title: row.title });
  return { ok: true, data: { id } };
};

/** 文書の関連先が「お知らせ」「決算情報」のとき、それが株主に公開されているか。関連先が無い・他の種類・見つからないときは true */
const isAttachedEntityPublished = async (
  document: { organizationId: string; entityType?: string | null; entityId?: string | null },
  admin: SupabaseClient,
): Promise<boolean> => {
  if (!document.entityId || !isUuid(document.entityId)) return true;
  if (document.entityType === 'shareholder_update') {
    const { data } = await admin
      .from('shareholder_updates')
      .select('status')
      .eq('organizationId', document.organizationId)
      .eq('id', document.entityId)
      .maybeSingle();
    // お知らせが見つからない（消された）ときは、添付も株主には見せない
    return data != null && (data as { status: string }).status === 'published';
  }
  if (document.entityType === 'financial_report') {
    const { data } = await admin
      .from('financial_reports')
      .select('isPublishedToShareholders')
      .eq('organizationId', document.organizationId)
      .eq('id', document.entityId)
      .maybeSingle();
    // 決算情報が見つからない（消された）ときは、添付も株主には見せない
    return data != null && (data as { isPublishedToShareholders: boolean }).isPublishedToShareholders === true;
  }
  return true;
};

/**
 * この人が文書を読めるか。
 *   社内（管理者・メンバー・閲覧のみ）: 自組織の文書すべて
 *   株主: 公開範囲が「全株主」のもの、または「指定した株主」で自分（stakeholderId）が指定されているもの。
 *         ただし、下書きのお知らせ・未公開の決算に付けた文書は、公開されるまで読めない
 */
export const canReadDocument = async (
  profile: Pick<CurrentProfile, 'organizationId' | 'role' | 'stakeholderId'>,
  document: { id: string; organizationId: string; visibility: string; entityType?: string | null; entityId?: string | null },
  admin: SupabaseClient,
): Promise<boolean> => {
  if (document.organizationId !== profile.organizationId) return false;
  if (isInternal(profile.role)) return true;
  // 下書きのお知らせ・未公開の決算に付けた文書は、それが公開されるまで株主には見せない
  // （文書の公開範囲が「全株主」でも、id を知っているだけでは読めないようにする）
  if (!(await isAttachedEntityPublished(document, admin))) return false;
  if (document.visibility === 'shareholders') return true;
  if (document.visibility !== 'restricted' || !profile.stakeholderId) return false;
  const { data } = await admin
    .from('document_shares')
    .select('id')
    .eq('documentId', document.id)
    .eq('stakeholderId', profile.stakeholderId)
    .maybeSingle();
  return Boolean(data);
};

/** ダウンロード用の短時間だけ有効な URL を作る。読めない・見つからないときは null（区別しない） */
export const createDownloadUrl = async (
  profile: Pick<CurrentProfile, 'organizationId' | 'role' | 'stakeholderId'> & { id?: string },
  id: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<string | null> => {
  if (!isUuid(id)) return null;
  const { data } = await admin
    .from('documents')
    .select('id, organizationId, visibility, entityType, entityId, storagePath, fileName')
    .eq('id', id)
    .maybeSingle();
  const document = data as {
    id: string;
    organizationId: string;
    visibility: string;
    entityType: string | null;
    entityId: string | null;
    storagePath: string;
    fileName: string;
  } | null;
  if (!document || !(await canReadDocument(profile, document, admin))) return null;
  const { data: signed } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(document.storagePath, DOWNLOAD_URL_TTL_SECONDS, { download: document.fileName });
  if (!signed?.signedUrl) return null;
  // だれが・どの文書をダウンロードしたかを残す（株主名簿の写しなど、個人情報を含む文書の持ち出しの記録）
  await recordAudit(admin, { id: profile.id ?? null, organizationId: document.organizationId }, 'documents.download', 'documents', document.id, {
    fileName: document.fileName,
    role: profile.role,
  });
  return signed.signedUrl;
};

/** 保存済みのファイルの中身を読む（AI 取り込みで使う）。自組織の文書だけ */
export const readDocumentFile = async (
  organizationId: string,
  id: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<{ document: DocumentRow; data: Uint8Array } | null> => {
  if (!isUuid(id)) return null;
  const { data } = await admin
    .from('documents')
    .select(`${DOCUMENT_COLUMNS}, storagePath`)
    .eq('organizationId', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const { storagePath, ...document } = data as unknown as DocumentRow & { storagePath: string };
  const { data: blob } = await admin.storage.from(DOCUMENTS_BUCKET).download(storagePath);
  if (!blob) return null;
  return { document, data: new Uint8Array(await blob.arrayBuffer()) };
};
