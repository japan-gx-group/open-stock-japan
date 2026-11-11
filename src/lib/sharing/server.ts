// 文書の共有（サーバ専用）: 株主ごとの公開先（document_shares）と、ログイン不要の期限つき共有リンク（share_links）。
//
// 守ること:
//   - 社内向けの関数（〜ForEditor）は、呼び出し側が requireEditor を通してから呼ぶ。組織は profile.organizationId で絞る。
//   - 共有リンクのトークンは作成時の戻り値にだけ含める。DB・監査ログ・ログ出力には残さない（保存するのは SHA-256 だけ）。
//   - 公開側（lookupShareLink / consumeShareLink）は、無効・期限切れ・取り消し済み・存在しないを区別せず null を返す。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CurrentProfile } from '@/lib/currentProfile';
import { DOCUMENTS_BUCKET, DOWNLOAD_URL_TTL_SECONDS } from '@/lib/documents/server';
import { DOCUMENT_VISIBILITIES } from '@/lib/resources/definitions';
import { isUuid } from '@/lib/resources/fields';
import { recordAudit, type WriteResult } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  expiryFromDays,
  generateShareToken,
  hashShareToken,
  isShareTokenFormat,
  parseExpiryDays,
  SHARE_LINK_DEFAULT_DAYS,
  SHARE_LINK_MAX_DAYS,
  SHARE_LINK_MIN_DAYS,
  shareLinkStatus,
  type ShareLinkStatus,
} from './token';

type Actor = Pick<CurrentProfile, 'id' | 'organizationId'>;
type Visibility = (typeof DOCUMENT_VISIBILITIES)[number]['value'];

const NOT_FOUND = { ok: false, status: 404, error: '文書が見つかりません' } as const;
const MAX_SHARE_TARGETS = 500;

const isVisibility = (value: unknown): value is Visibility =>
  typeof value === 'string' && DOCUMENT_VISIBILITIES.some((option) => option.value === value);

/** 自組織の文書を 1 件読む（無ければ null） */
const findDocument = async (
  admin: SupabaseClient,
  organizationId: string,
  id: string,
): Promise<{ id: string; title: string; visibility: Visibility } | null> => {
  if (!isUuid(id)) return null;
  const { data } = await admin
    .from('documents')
    .select('id, title, visibility')
    .eq('organizationId', organizationId)
    .eq('id', id)
    .maybeSingle();
  return (data as { id: string; title: string; visibility: Visibility } | null) ?? null;
};

// ---- 公開範囲と、公開先の株主 ----

export interface DocumentSharing {
  visibility: Visibility;
  stakeholderIds: string[];
}

export const getDocumentSharing = async (
  organizationId: string,
  documentId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<DocumentSharing | null> => {
  const document = await findDocument(admin, organizationId, documentId);
  if (!document) return null;
  const { data, error } = await admin
    .from('document_shares')
    .select('stakeholderId')
    .eq('organizationId', organizationId)
    .eq('documentId', documentId);
  if (error) throw new Error('公開先の取得に失敗しました');
  return {
    visibility: document.visibility,
    stakeholderIds: ((data ?? []) as { stakeholderId: string }[]).map((row) => row.stakeholderId),
  };
};

/**
 * 公開範囲と公開先の株主をまとめて置き換える。
 * 公開先（stakeholderIds）は「指定した株主に公開」のときだけ保存し、それ以外では空にする
 * （公開範囲を戻したときに、以前の公開先が黙って生き返らないようにする）。
 */
export const setDocumentSharing = async (
  actor: Actor,
  documentId: string,
  raw: unknown,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<DocumentSharing>> => {
  const document = await findDocument(admin, actor.organizationId, documentId);
  if (!document) return NOT_FOUND;
  const body = (raw && typeof raw === 'object' ? raw : {}) as { visibility?: unknown; stakeholderIds?: unknown };
  if (!isVisibility(body.visibility)) return { ok: false, status: 400, error: '公開範囲を選択してください' };
  const visibility = body.visibility;

  const requested = body.stakeholderIds == null ? [] : body.stakeholderIds;
  if (!Array.isArray(requested) || requested.length > MAX_SHARE_TARGETS || !requested.every(isUuid)) {
    return { ok: false, status: 400, error: '公開先の株主の指定が正しくありません' };
  }
  const stakeholderIds = visibility === 'restricted' ? Array.from(new Set(requested.map((id) => id.toLowerCase()))) : [];
  if (visibility === 'restricted' && stakeholderIds.length === 0) {
    return { ok: false, status: 400, error: '公開先の株主を 1 名以上選んでください' };
  }

  // 公開先がすべて自組織の権利者であることを確かめる（FK は行の存在しか見ない）
  if (stakeholderIds.length > 0) {
    const { data, error } = await admin
      .from('stakeholders')
      .select('id')
      .eq('organizationId', actor.organizationId)
      .in('id', stakeholderIds);
    if (error) return { ok: false, status: 500, error: '公開先の確認に失敗しました' };
    if ((data ?? []).length !== stakeholderIds.length) {
      return { ok: false, status: 400, error: '公開先に見つからない株主が含まれています。選び直してください' };
    }
  }

  const { data: currentRows, error: currentError } = await admin
    .from('document_shares')
    .select('stakeholderId')
    .eq('organizationId', actor.organizationId)
    .eq('documentId', documentId);
  if (currentError) return { ok: false, status: 500, error: '公開先の保存に失敗しました' };
  const current = ((currentRows ?? []) as { stakeholderId: string }[]).map((row) => row.stakeholderId);
  const toRemove = current.filter((id) => !stakeholderIds.includes(id));
  const toAdd = stakeholderIds.filter((id) => !current.includes(id));

  // 見える範囲が広がる順序を避ける: 先に外す分を消し、公開範囲を変え、最後に足す。
  if (toRemove.length > 0) {
    const { error } = await admin
      .from('document_shares')
      .delete()
      .eq('organizationId', actor.organizationId)
      .eq('documentId', documentId)
      .in('stakeholderId', toRemove);
    if (error) return { ok: false, status: 500, error: '公開先の保存に失敗しました' };
  }
  if (visibility !== document.visibility) {
    const { error } = await admin
      .from('documents')
      .update({ visibility })
      .eq('organizationId', actor.organizationId)
      .eq('id', documentId);
    if (error) return { ok: false, status: 500, error: '公開範囲の保存に失敗しました' };
  }
  if (toAdd.length > 0) {
    const { error } = await admin
      .from('document_shares')
      .insert(toAdd.map((stakeholderId) => ({ organizationId: actor.organizationId, documentId, stakeholderId })));
    if (error) return { ok: false, status: 500, error: '公開先の保存に失敗しました' };
  }

  await recordAudit(admin, actor, 'documents.sharing.update', 'documents', documentId, {
    title: document.title,
    previousVisibility: document.visibility,
    visibility,
    added: toAdd,
    removed: toRemove,
  });
  return { ok: true, data: { visibility, stakeholderIds } };
};

// ---- 共有リンク ----

const LINK_COLUMNS = 'id, documentId, label, expiresAt, revokedAt, accessCount, lastAccessedAt, createdAt';

export interface ShareLinkRow {
  id: string;
  documentId: string;
  label: string;
  expiresAt: string;
  revokedAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  status: ShareLinkStatus;
}

const toLinkRow = (row: Omit<ShareLinkRow, 'status'>): ShareLinkRow => ({
  ...row,
  accessCount: Number(row.accessCount),
  status: shareLinkStatus(row),
});

export const listShareLinks = async (
  organizationId: string,
  documentId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<ShareLinkRow[] | null> => {
  if (!(await findDocument(admin, organizationId, documentId))) return null;
  const { data, error } = await admin
    .from('share_links')
    .select(LINK_COLUMNS)
    .eq('organizationId', organizationId)
    .eq('documentId', documentId)
    .order('createdAt', { ascending: false })
    .limit(200);
  if (error) throw new Error('共有リンクの取得に失敗しました');
  return ((data ?? []) as unknown as Omit<ShareLinkRow, 'status'>[]).map(toLinkRow);
};

/** 共有リンクを作る。token は戻り値にだけ含まれる（二度と取り出せない） */
export const createShareLink = async (
  actor: Actor,
  raw: unknown,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<{ link: ShareLinkRow; token: string }>> => {
  const body = (raw && typeof raw === 'object' ? raw : {}) as { documentId?: unknown; label?: unknown; expiresInDays?: unknown };
  const document = typeof body.documentId === 'string' ? await findDocument(admin, actor.organizationId, body.documentId) : null;
  if (!document) return NOT_FOUND;
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (label.length > 200) return { ok: false, status: 400, error: 'メモは 200 文字以内で入力してください', fieldErrors: { label: 'メモは 200 文字以内で入力してください' } };
  const days = parseExpiryDays(body.expiresInDays ?? SHARE_LINK_DEFAULT_DAYS);
  if (days == null) {
    const message = `有効期間は ${SHARE_LINK_MIN_DAYS}〜${SHARE_LINK_MAX_DAYS} 日で指定してください`;
    return { ok: false, status: 400, error: message, fieldErrors: { expiresInDays: message } };
  }

  const token = generateShareToken();
  const { data, error } = await admin
    .from('share_links')
    .insert({
      organizationId: actor.organizationId,
      documentId: document.id,
      label,
      tokenHash: hashShareToken(token),
      expiresAt: expiryFromDays(days),
      createdByUserId: actor.id,
    })
    .select(LINK_COLUMNS)
    .single();
  if (error || !data) return { ok: false, status: 500, error: '共有リンクの作成に失敗しました' };
  const link = toLinkRow(data as unknown as Omit<ShareLinkRow, 'status'>);
  // トークンもそのハッシュも監査ログには残さない
  await recordAudit(admin, actor, 'share_links.create', 'share_links', link.id, {
    documentId: document.id,
    title: document.title,
    label,
    expiresAt: link.expiresAt,
  });
  return { ok: true, data: { link, token } };
};

/** 共有リンクを取り消す（revokedAt を入れる。行は履歴として残す） */
export const revokeShareLink = async (
  actor: Actor,
  id: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<ShareLinkRow>> => {
  const notFound = { ok: false, status: 404, error: '共有リンクが見つかりません' } as const;
  if (!isUuid(id)) return notFound;
  const { data: existing } = await admin
    .from('share_links')
    .select(LINK_COLUMNS)
    .eq('organizationId', actor.organizationId)
    .eq('id', id)
    .maybeSingle();
  if (!existing) return notFound;
  const before = existing as unknown as Omit<ShareLinkRow, 'status'>;
  if (before.revokedAt) return { ok: true, data: toLinkRow(before) };

  const { data, error } = await admin
    .from('share_links')
    .update({ revokedAt: new Date().toISOString() })
    .eq('organizationId', actor.organizationId)
    .eq('id', id)
    .select(LINK_COLUMNS)
    .single();
  if (error || !data) return { ok: false, status: 500, error: '共有リンクの取り消しに失敗しました' };
  const link = toLinkRow(data as unknown as Omit<ShareLinkRow, 'status'>);
  await recordAudit(admin, actor, 'share_links.revoke', 'share_links', id, { documentId: link.documentId, label: link.label });
  return { ok: true, data: link };
};

// ---- 公開側（ログイン不要） ----

/** 共有ページに出す情報。これ以外の組織の情報は返さない */
export interface PublicShare {
  organizationName: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  expiresAt: string;
}

/**
 * トークンから共有リンクを引く（アクセス回数は進めない）。
 * 形が違う・存在しない・期限切れ・取り消し済み・文書が無い、のどれも null（区別しない）。
 */
export const lookupShareLink = async (token: string, admin: SupabaseClient = createAdminClient()): Promise<PublicShare | null> => {
  if (!isShareTokenFormat(token)) return null;
  const { data: linkData } = await admin
    .from('share_links')
    .select('documentId, organizationId, expiresAt, revokedAt')
    .eq('tokenHash', hashShareToken(token))
    .maybeSingle();
  const link = linkData as { documentId: string; organizationId: string; expiresAt: string; revokedAt: string | null } | null;
  if (!link || shareLinkStatus(link) !== 'active') return null;

  const [{ data: documentData }, { data: organization }] = await Promise.all([
    admin
      .from('documents')
      .select('title, fileName, sizeBytes')
      .eq('organizationId', link.organizationId)
      .eq('id', link.documentId)
      .maybeSingle(),
    admin.from('organizations').select('name').eq('id', link.organizationId).maybeSingle(),
  ]);
  const document = documentData as { title: string; fileName: string; sizeBytes: number } | null;
  if (!document || !organization) return null;
  return {
    organizationName: String((organization as { name: unknown }).name ?? ''),
    title: document.title,
    fileName: document.fileName,
    sizeBytes: Number(document.sizeBytes),
    expiresAt: link.expiresAt,
  };
};

/**
 * ダウンロード: touch_share_link（有効性の確認とアクセス回数の加算を 1 文で行う RPC）を通し、
 * 通ったときだけ短時間有効な署名つき URL を返す。通らなければ null（理由は区別しない）。
 */
export const consumeShareLink = async (token: string, admin: SupabaseClient = createAdminClient()): Promise<string | null> => {
  if (!isShareTokenFormat(token)) return null;
  const { data, error } = await admin.rpc('touch_share_link', { p_token_hash: hashShareToken(token) });
  if (error) return null;
  const touched = (Array.isArray(data) ? data[0] : data) as { documentId?: string; organizationId?: string } | null | undefined;
  if (!touched?.documentId || !touched.organizationId) return null;
  const { data: documentData } = await admin
    .from('documents')
    .select('storagePath, fileName')
    .eq('organizationId', touched.organizationId)
    .eq('id', touched.documentId)
    .maybeSingle();
  const document = documentData as { storagePath: string; fileName: string } | null;
  if (!document) return null;
  const { data: signed } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(document.storagePath, DOWNLOAD_URL_TTL_SECONDS, { download: document.fileName });
  if (!signed?.signedUrl) return null;
  // ログインしていない人のアクセスなので、操作した人は空。接続元（IP アドレス・ブラウザ）は DB が残す
  await recordAudit(admin, { id: null, organizationId: touched.organizationId }, 'share_links.access', 'documents', touched.documentId, {
    fileName: document.fileName,
  });
  return signed.signedUrl;
};
