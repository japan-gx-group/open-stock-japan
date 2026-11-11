// AI 取り込みのサーバ側の処理（サーバ専用）。読取り・一覧・反映・破棄。
//
// 呼び出し側（Route Handler）が requireInternal / requireEditor でロールを確かめてから呼ぶ。
// 組織 ID は profile から取り、service_role のクエリは必ず organizationId で絞る。
//
// 反映（applyExtraction）の決まり:
//   - AI の結果も、画面から送られた行も信じない。今の台帳を読み直し、checkReview とリソース定義の検証を通す。
//   - 台帳への書き込みは createResource を通す（検証・組織の限定・参照の確認・監査ログ）。
//   - 途中で失敗したら、この反映で作った行を逆順に消す（できる範囲で。消せなかった行はそのまま伝える）。
//   - 同じ読取りを 2 回反映させない（最初に状態を applied に変えられた 1 回だけが進む）。

import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateStructured } from '@/lib/ai/generate';
import type { AiInputPart } from '@/lib/ai/inputCheck';
import { DEFAULT_MAX_INPUT_BYTES } from '@/lib/ai/purposes';
import type { CurrentProfile } from '@/lib/currentProfile';
import { DOCUMENT_COLUMNS, readDocumentFile, uploadDocument, type DocumentRow } from '@/lib/documents/server';
import { COMPANY_COLUMNS, COMPANY_DEF } from '@/lib/resources/company';
import { RESOURCES, type ResourceName } from '@/lib/resources/definitions';
import { isUuid, normalizeRow, parseFieldValue, parseResourceInput, type ResourceRow, type ResourceValues } from '@/lib/resources/fields';
import { createResource, deleteResource, listResource, recordAudit } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/types/role';
import type { AiGenerateErrorCode } from '@/types/ai';
import { parseApplyPayload, planApply, type ApplyStep } from './applyPlan';
import { DOCUMENT_LINK_TARGETS, documentKindDef, GROUP_SPECS, isImportDocumentKind, resourceDefOf, reviewFieldsOf } from './groups';
import { buildReviewState, buildRowBody, checkReview, firstReviewError, mergeCompanyValues, parseRef } from './review';
import { buildExtractionInstructions, buildExtractionSchema, CLASSIFY_INSTRUCTIONS, CLASSIFY_SCHEMA, validateClassification } from './schema';
import type {
  AppliedSummary,
  ExtractionDetail,
  ExtractionResponse,
  ExtractionStatus,
  ExtractionSummaryRow,
  GroupKey,
  ImportContext,
  ImportDocumentKind,
  ImportExtraction,
  RowIssues,
} from './types';
import { parseStoredExtraction, validateExtraction } from './validate';

type Actor = Pick<CurrentProfile, 'id' | 'organizationId' | 'role'>;

export const MAX_AI_FILE_BYTES = DEFAULT_MAX_INPUT_BYTES;
/** 文字のファイルを AI に送るときの上限（文字数） */
const MAX_TEXT_CHARS = 200_000;

const AI_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain'];

export type ImportFailure = {
  ok: false;
  status: 400 | 404 | 409 | 413 | 429 | 500 | 502;
  error: string;
  code?: string;
  /** 保存済みの文書（読取りだけが失敗したとき。もう一度読み取れる） */
  document?: DocumentRow;
  rowIssues?: Record<string, RowIssues>;
};
export type ImportResult<T> = { ok: true; data: T } | ImportFailure;

// ---- 台帳の今の状態 ----

const str = (row: ResourceRow, key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '');
const strOrNull = (row: ResourceRow, key: string): string | null => (typeof row[key] === 'string' && row[key] !== '' ? (row[key] as string) : null);
const num = (row: ResourceRow, key: string): number => (typeof row[key] === 'number' ? (row[key] as number) : 0);

export const loadImportContext = async (actor: Actor, admin: SupabaseClient = createAdminClient()): Promise<ImportContext> => {
  const org = actor.organizationId;
  const list = (name: ResourceName) => listResource(name, org, {}, admin);
  const [stakeholders, shareClasses, fundingRounds, convertibleRounds, optionPlans, fiscalYears, officers, meetings, reports, transactions, grants, investments, company] =
    await Promise.all([
      list('stakeholders'),
      list('share-classes'),
      list('funding-rounds'),
      list('convertible-rounds'),
      list('option-plans'),
      list('fiscal-years'),
      list('officers'),
      list('meetings'),
      list('financial-reports'),
      list('share-transactions'),
      list('option-grants'),
      list('convertible-investments'),
      admin.from('organizations').select(COMPANY_COLUMNS).eq('id', org).maybeSingle(),
    ]);
  const named = (rows: ResourceRow[], key = 'name') => rows.map((row) => ({ id: row.id, label: str(row, key) }));

  let companyRow: ResourceValues | null = null;
  if (company.data) {
    const row = normalizeRow(COMPANY_DEF, company.data as unknown as Record<string, unknown>);
    // fiscalYearStartMonth は選択肢（文字）で扱い、smallint で保存する（/api/company と同じ）
    if (row.fiscalYearStartMonth != null) row.fiscalYearStartMonth = String(row.fiscalYearStartMonth);
    companyRow = row;
  }

  return {
    stakeholders: named(stakeholders),
    shareClasses: named(shareClasses),
    fundingRounds: named(fundingRounds),
    convertibleRounds: convertibleRounds.map((row) => ({ id: row.id, label: str(row, 'name'), roundNo: num(row, 'roundNo') })),
    optionPlans: optionPlans.map((row) => ({ id: row.id, label: str(row, 'name'), totalUnits: num(row, 'totalUnits') })),
    fiscalYears: fiscalYears.map((row) => ({ id: row.id, label: str(row, 'label'), startDate: str(row, 'startDate'), endDate: str(row, 'endDate') })),
    officers: officers.map((row) => ({ id: row.id, name: str(row, 'name'), position: str(row, 'position'), retiredOn: strOrNull(row, 'retiredOn') })),
    meetings: meetings.map((row) => ({ id: row.id, title: str(row, 'title'), heldOn: strOrNull(row, 'heldOn'), meetingType: str(row, 'meetingType') })),
    financialReports: reports.map((row) => ({ id: row.id, title: str(row, 'title'), periodStart: str(row, 'periodStart'), periodEnd: str(row, 'periodEnd') })),
    shareTransactions: transactions.map((row) => ({
      stakeholderId: str(row, 'stakeholderId'),
      shareClassId: str(row, 'shareClassId'),
      transactionDate: str(row, 'transactionDate'),
      shares: num(row, 'shares'),
    })),
    optionGrants: grants.map((row) => ({ planId: str(row, 'planId'), stakeholderId: str(row, 'stakeholderId'), units: num(row, 'units') })),
    convertibleInvestments: investments.map((row) => ({ roundId: str(row, 'roundId'), stakeholderId: str(row, 'stakeholderId'), amount: num(row, 'amount') })),
    company: companyRow,
    canEditCompany: isAdmin(actor.role),
  };
};

// ---- 読取り ----

const aiFailureStatus = (code: AiGenerateErrorCode): ImportFailure['status'] =>
  code === 'limit_exceeded' || code === 'rate_limited' ? 429 : code === 'invalid_input' ? 400 : 502;

const toInputPart = (mimeType: string, data: Uint8Array): AiInputPart | null => {
  if (mimeType === 'application/pdf') return { type: 'pdf', data };
  if (mimeType.startsWith('image/')) return { type: 'image', data };
  if (mimeType === 'text/plain') {
    const text = new TextDecoder('utf-8').decode(data).slice(0, MAX_TEXT_CHARS).trim();
    return text ? { type: 'text', text } : null;
  }
  return null;
};

interface AiExtraction {
  result: ImportExtraction;
  provider: string;
  modelId: string;
}

/** 文書の種類の判定（自動のとき）と、読取り。AI の呼び出しは 1 回（自動判定のときは 2 回） */
const runExtraction = async (
  actor: Actor,
  file: { mimeType: string; data: Uint8Array },
  requestedKind: ImportDocumentKind | 'auto',
  signal?: AbortSignal,
): Promise<ImportResult<AiExtraction>> => {
  const part = toInputPart(file.mimeType, file.data);
  if (!part) return { ok: false, status: 400, error: 'AI で読み取れるのは PDF、画像（PNG・JPEG・WebP）、テキストのファイルです', code: 'unsupported_type' };

  let kind: ImportDocumentKind;
  let classifyNote: string | null = null;
  if (requestedKind === 'auto') {
    const classified = await generateStructured({
      purpose: 'document_extraction',
      profile: actor,
      instructions: CLASSIFY_INSTRUCTIONS,
      input: [part],
      schema: CLASSIFY_SCHEMA,
      validate: validateClassification,
      signal,
    });
    if (!classified.ok) return { ok: false, status: aiFailureStatus(classified.code), error: classified.message, code: classified.code };
    if (!classified.value.documentKind) {
      return {
        ok: false,
        status: 400,
        error: `文書の種類を自動で判定できませんでした${classified.value.reason ? `（${classified.value.reason}）` : ''}。種類を選んで、もう一度読み取ってください`,
        code: 'kind_undetermined',
      };
    }
    kind = classified.value.documentKind;
    classifyNote = `文書の種類を「${documentKindDef(kind).label}」と自動で判定しました${classified.value.reason ? `（${classified.value.reason}）` : ''}。違う場合は破棄して、種類を選び直してください`;
  } else {
    kind = requestedKind;
  }

  const extracted = await generateStructured({
    purpose: 'document_extraction',
    profile: actor,
    instructions: buildExtractionInstructions(kind),
    input: [part],
    schema: buildExtractionSchema(kind),
    validate: validateExtraction(kind),
    signal,
  });
  if (!extracted.ok) return { ok: false, status: aiFailureStatus(extracted.code), error: extracted.message, code: extracted.code };
  const result = classifyNote ? { ...extracted.value, warnings: [classifyNote, ...extracted.value.warnings] } : extracted.value;
  return { ok: true, data: { result, provider: extracted.provider, modelId: extracted.modelId } };
};

const EXTRACTION_COLUMNS =
  'id, documentId, documentKind, status, provider, modelId, result, appliedSummary, createdByUserId, appliedByUserId, appliedAt, createdAt';

interface ExtractionDbRow {
  id: string;
  documentId: string;
  documentKind: string;
  status: ExtractionStatus;
  provider: string;
  modelId: string;
  result: unknown;
  appliedSummary: unknown;
  createdByUserId: string | null;
  appliedByUserId: string | null;
  appliedAt: string | null;
  createdAt: string;
}

const userNames = async (admin: SupabaseClient, organizationId: string, ids: (string | null)[]): Promise<Map<string, string>> => {
  const unique = [...new Set(ids.filter((id): id is string => id != null))];
  if (unique.length === 0) return new Map();
  const { data } = await admin.from('profiles').select('id, fullName, email').eq('organizationId', organizationId).in('id', unique);
  return new Map(((data ?? []) as { id: string; fullName: string | null; email: string }[]).map((row) => [row.id, row.fullName || row.email]));
};

const toSummaryRow = (row: ExtractionDbRow, documentTitle: string, names: Map<string, string>): ExtractionSummaryRow => ({
  id: row.id,
  documentId: row.documentId,
  documentTitle,
  documentKind: row.documentKind as ImportDocumentKind,
  status: row.status,
  provider: row.provider,
  modelId: row.modelId,
  createdAt: row.createdAt,
  createdByName: row.createdByUserId ? (names.get(row.createdByUserId) ?? null) : null,
  appliedAt: row.appliedAt,
  appliedByName: row.appliedByUserId ? (names.get(row.appliedByUserId) ?? null) : null,
});

const buildResponse = async (
  actor: Actor,
  row: ExtractionDbRow,
  document: DocumentRow,
  result: ImportExtraction,
  admin: SupabaseClient,
): Promise<ExtractionResponse> => {
  const [context, names] = await Promise.all([
    loadImportContext(actor, admin),
    userNames(admin, actor.organizationId, [row.createdByUserId, row.appliedByUserId]),
  ]);
  const extraction: ExtractionDetail = {
    ...toSummaryRow(row, document.title, names),
    result,
    appliedSummary: (row.appliedSummary as AppliedSummary | null) ?? null,
    document: {
      id: document.id,
      title: document.title,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: Number(document.sizeBytes),
      category: document.category,
    },
  };
  return { extraction, review: buildReviewState(result, context), context };
};

const saveExtraction = async (
  actor: Actor,
  document: DocumentRow,
  extracted: AiExtraction,
  admin: SupabaseClient,
): Promise<ImportResult<ExtractionResponse>> => {
  const { data, error } = await admin
    .from('document_extractions')
    .insert({
      organizationId: actor.organizationId,
      documentId: document.id,
      documentKind: extracted.result.documentKind,
      status: 'extracted',
      provider: extracted.provider,
      modelId: extracted.modelId,
      result: extracted.result,
      createdByUserId: actor.id,
    })
    .select(EXTRACTION_COLUMNS)
    .single();
  if (error || !data) {
    return { ok: false, status: 500, error: '読取りの結果の保存に失敗しました。文書は保存済みなので、もう一度読み取ってください', document };
  }
  const row = data as unknown as ExtractionDbRow;
  await recordAudit(admin, actor, 'import.extract', 'document_extractions', row.id, {
    documentId: document.id,
    documentKind: row.documentKind,
    provider: row.provider,
    modelId: row.modelId,
  });
  return { ok: true, data: await buildResponse(actor, row, document, extracted.result, admin) };
};

/** 文書の分類を、判定した種類に合わせる（自動判定で保存した文書） */
const alignDocumentCategory = async (admin: SupabaseClient, actor: Actor, document: DocumentRow, kind: ImportDocumentKind): Promise<DocumentRow> => {
  const category = documentKindDef(kind).category;
  if (document.category === category || document.category !== 'other') return document;
  await admin.from('documents').update({ category }).eq('organizationId', actor.organizationId).eq('id', document.id);
  return { ...document, category };
};

const extractStored = async (
  actor: Actor,
  document: DocumentRow,
  data: Uint8Array,
  kind: ImportDocumentKind | 'auto',
  admin: SupabaseClient,
  signal?: AbortSignal,
): Promise<ImportResult<ExtractionResponse>> => {
  if (!AI_MIME_TYPES.includes(document.mimeType)) {
    return { ok: false, status: 400, error: 'AI で読み取れるのは PDF、画像（PNG・JPEG・WebP）、テキストのファイルです', code: 'unsupported_type', document };
  }
  if (data.byteLength > MAX_AI_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'ファイルが 4MB を超えるため、AI には送っていません（文書はライブラリに保存しました）。ページを分けるか、画質を落とした 4MB 以下のファイルで読み取ってください',
      code: 'too_large',
      document,
    };
  }
  const extracted = await runExtraction(actor, { mimeType: document.mimeType, data }, kind, signal);
  if (!extracted.ok) return { ...extracted, document };
  const aligned = await alignDocumentCategory(admin, actor, document, extracted.data.result.documentKind);
  return saveExtraction(actor, aligned, extracted.data, admin);
};

export interface ExtractInput {
  fileName: string;
  data: Uint8Array;
  documentKind: ImportDocumentKind | 'auto';
  title?: string;
  signal?: AbortSignal;
}

/** ファイルを文書ライブラリに保存し、AI で読み取る。読取りが失敗しても文書は残す（もう一度読み取れる） */
export const extractFromUpload = async (actor: Actor, input: ExtractInput): Promise<ImportResult<ExtractionResponse>> => {
  const admin = createAdminClient();
  const uploaded = await uploadDocument(
    actor,
    {
      fileName: input.fileName,
      data: input.data,
      title: input.title,
      category: input.documentKind === 'auto' ? 'other' : documentKindDef(input.documentKind).category,
      visibility: 'internal',
    },
    admin,
  );
  if (!uploaded.ok) return { ok: false, status: uploaded.status === 500 ? 500 : 400, error: uploaded.error };
  return extractStored(actor, uploaded.data, input.data, input.documentKind, admin, input.signal);
};

/** 保存済みの文書を、もう一度（または初めて）AI で読み取る */
export const extractFromDocument = async (
  actor: Actor,
  documentId: string,
  documentKind: ImportDocumentKind | 'auto',
  signal?: AbortSignal,
): Promise<ImportResult<ExtractionResponse>> => {
  const admin = createAdminClient();
  const file = await readDocumentFile(actor.organizationId, documentId, admin);
  if (!file) return { ok: false, status: 404, error: '文書が見つかりません' };
  return extractStored(actor, file.document, file.data, documentKind, admin, signal);
};

// ---- 一覧・1 件 ----

export const listExtractions = async (actor: Actor, admin: SupabaseClient = createAdminClient()): Promise<ExtractionSummaryRow[]> => {
  const { data, error } = await admin
    .from('document_extractions')
    .select('id, documentId, documentKind, status, provider, modelId, createdByUserId, appliedByUserId, appliedAt, createdAt')
    .eq('organizationId', actor.organizationId)
    .order('createdAt', { ascending: false })
    .limit(200);
  if (error) throw new Error('取り込みの履歴の取得に失敗しました');
  const rows = (data ?? []) as unknown as ExtractionDbRow[];
  if (rows.length === 0) return [];
  const [documents, names] = await Promise.all([
    admin.from('documents').select('id, title').eq('organizationId', actor.organizationId).in('id', [...new Set(rows.map((row) => row.documentId))]),
    userNames(admin, actor.organizationId, rows.flatMap((row) => [row.createdByUserId, row.appliedByUserId])),
  ]);
  const titles = new Map(((documents.data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]));
  return rows.map((row) => toSummaryRow(row, titles.get(row.documentId) ?? '（文書が見つかりません）', names));
};

const readExtraction = async (
  actor: Actor,
  id: string,
  admin: SupabaseClient,
): Promise<{ row: ExtractionDbRow; document: DocumentRow; result: ImportExtraction } | null> => {
  if (!isUuid(id)) return null;
  const { data } = await admin
    .from('document_extractions')
    .select(EXTRACTION_COLUMNS)
    .eq('organizationId', actor.organizationId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as ExtractionDbRow;
  const { data: document } = await admin
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('organizationId', actor.organizationId)
    .eq('id', row.documentId)
    .maybeSingle();
  const result = parseStoredExtraction(row.result);
  if (!document || !result || !isImportDocumentKind(row.documentKind)) return null;
  return { row, document: document as unknown as DocumentRow, result };
};

/** 1 件の読取りと、今の台帳との照合 */
export const getExtraction = async (actor: Actor, id: string): Promise<ExtractionResponse | null> => {
  const admin = createAdminClient();
  const found = await readExtraction(actor, id, admin);
  return found ? buildResponse(actor, found.row, found.document, found.result, admin) : null;
};

// ---- 破棄 ----

export const discardExtraction = async (actor: Actor, id: string): Promise<ImportResult<{ id: string }>> => {
  if (!isUuid(id)) return { ok: false, status: 404, error: '読取りの結果が見つかりません' };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('document_extractions')
    .update({ status: 'discarded' })
    .eq('organizationId', actor.organizationId)
    .eq('id', id)
    .eq('status', 'extracted')
    .select('id');
  if (error) return { ok: false, status: 500, error: '破棄に失敗しました' };
  if ((data ?? []).length === 0) return { ok: false, status: 409, error: 'この読取りの結果は、すでに反映または破棄されています' };
  await recordAudit(admin, actor, 'import.discard', 'document_extractions', id, {});
  return { ok: true, data: { id } };
};

// ---- 反映 ----

interface Created {
  group: GroupKey;
  rowKey: string;
  resource: ResourceName;
  id: string;
  label: string;
  href?: string;
}

type StepResult = { ok: true; created: Created[] } | { ok: false; error: string };

const PROVENANCE_MAX = 200;

const createStep = async (
  actor: Actor,
  kind: ImportDocumentKind,
  step: ApplyStep,
  ids: Map<string, string>,
  provenance: string,
  admin: SupabaseClient,
): Promise<StepResult> => {
  const spec = GROUP_SPECS[step.group];
  if (spec.target.type !== 'resource') return { ok: false, error: '反映できない行が含まれています' };
  const resource = spec.target.resource;
  const body = buildRowBody(spec, kind, step.row, (value) => {
    const parsed = parseRef(value);
    return parsed?.mode === 'existing' ? parsed.id : parsed?.mode === 'new' ? (ids.get(parsed.key) ?? null) : null;
  });
  // どの文書から取り込んだかを、メモが空の行に残す（文書への関連づけができないリソースが多いため）
  if ('notes' in body && body.notes === '') body.notes = provenance;
  const result = await createResource(resource, actor, body, admin);
  if (!result.ok) return { ok: false, error: `${spec.label}: ${result.error}` };
  // 会議は、種類によって詳細の画面が違う
  const href = resource === 'meetings' ? `${result.data.meetingType === 'board' ? '/board-meetings' : '/shareholder-meetings'}/${result.data.id}` : undefined;
  return {
    ok: true,
    created: [{ group: step.group, rowKey: step.row.key, resource, id: result.data.id, label: RESOURCES[resource].labelOf(result.data), ...(href ? { href } : {}) }],
  };
};

/**
 * 株式譲渡: 譲渡人の減少と譲受人の増加の 2 行を、同じ groupId でまとめて作る（/api/equity/transfer と同じ形）。
 * 譲渡人が譲渡日時点で持っている株式数を超えないことは、反映の直前の checkReview（checkTransferRow）で確かめている。
 */
const transferStep = async (
  actor: Actor,
  kind: ImportDocumentKind,
  step: ApplyStep,
  ids: Map<string, string>,
  names: Map<string, string>,
  provenance: string,
  admin: SupabaseClient,
): Promise<StepResult> => {
  const spec = GROUP_SPECS.transfers;
  const resolve = (value: string | undefined): string | null => {
    const parsed = parseRef(value);
    return parsed?.mode === 'existing' ? parsed.id : parsed?.mode === 'new' ? (ids.get(parsed.key) ?? null) : null;
  };
  const fromId = resolve(step.row.refs.fromStakeholderId);
  const toId = resolve(step.row.refs.toStakeholderId);
  const shareClassId = resolve(step.row.refs.shareClassId);
  const values: ResourceValues = {};
  for (const field of reviewFieldsOf(spec, kind)) {
    const parsed = parseFieldValue(field, step.row.values[field.key]);
    if (!parsed.ok) return { ok: false, error: `${spec.label}: ${parsed.error}` };
    values[field.key] = parsed.value;
  }
  if (!fromId || !toId || !shareClassId || fromId === toId) return { ok: false, error: `${spec.label}: 譲渡人・譲受人・株式の種類を選び直してください` };

  const shares = values.shares as number;
  const price = values.pricePerShare as number | null;
  const groupId = randomUUID();
  const common = {
    organizationId: actor.organizationId,
    shareClassId,
    groupId,
    transactionDate: values.transactionDate as string,
    transactionType: 'transfer',
    pricePerShare: price,
    amount: price != null ? Math.round(price * shares) : null,
    notes: ((values.notes as string) || provenance).slice(0, 4000),
  };
  const fromName = names.get(fromId) ?? '';
  const toName = names.get(toId) ?? '';
  const { data, error } = await admin
    .from('share_transactions')
    .insert([
      { ...common, stakeholderId: fromId, shares: -shares, counterparty: toName },
      { ...common, stakeholderId: toId, shares, counterparty: fromName },
    ])
    .select('id');
  if (error || !data || data.length !== 2) return { ok: false, error: `${spec.label}: 株式譲渡の記録に失敗しました` };
  await recordAudit(admin, actor, 'share-transactions.transfer', 'share_transactions', null, { groupId, from: fromName, to: toName, shares, source: 'import' });
  const label = `${values.transactionDate} ${fromName} → ${toName} ${shares.toLocaleString('ja-JP')}株`;
  // 取り消しは 1 行を消せば、同じ groupId の 2 行がまとめて消える（deleteResource）
  return { ok: true, created: [{ group: 'transfers', rowKey: step.row.key, resource: 'share-transactions', id: (data[0] as { id: string }).id, label }] };
};

/** 会社情報: 選んだ項目だけを、今の値に重ねて検証してから更新する */
const companyStep = async (
  actor: Actor,
  kind: ImportDocumentKind,
  step: ApplyStep,
  context: ImportContext,
  admin: SupabaseClient,
): Promise<{ ok: true; fields: { key: string; label: string }[] } | { ok: false; error: string }> => {
  if (!isAdmin(actor.role)) return { ok: false, error: '会社情報の変更は管理者だけが行えます' };
  const fields = reviewFieldsOf(GROUP_SPECS.company, kind).filter((field) => (step.row.ticked ?? []).includes(field.key));
  if (fields.length === 0) return { ok: false, error: '会社情報: 反映する項目がありません' };
  const parsed = parseResourceInput(COMPANY_DEF, mergeCompanyValues(kind, step.row, context), 'update');
  if (!parsed.ok) return { ok: false, error: `会社情報: ${parsed.error}` };

  const patch: Record<string, unknown> = {};
  for (const field of fields) patch[field.key] = parsed.values[field.key];
  if ('fiscalYearStartMonth' in patch) patch.fiscalYearStartMonth = patch.fiscalYearStartMonth == null ? null : Number(patch.fiscalYearStartMonth);
  const { data, error } = await admin.from('organizations').update(patch).eq('id', actor.organizationId).select('id').maybeSingle();
  if (error || !data) return { ok: false, error: '会社情報の保存に失敗しました' };
  await recordAudit(admin, actor, 'company.update', 'organizations', actor.organizationId, { changed: fields.map((field) => field.key), source: 'import' });
  return { ok: true, fields: fields.map((field) => ({ key: field.key, label: field.label })) };
};

/** この反映で作った行を逆順に消す。消せなかった行の表示名を返す */
const rollback = async (actor: Actor, created: Created[], admin: SupabaseClient): Promise<string[]> => {
  const failed: string[] = [];
  for (const item of [...created].reverse()) {
    const result = await deleteResource(item.resource, actor, item.id, admin).catch(() => null);
    if (!result?.ok) failed.push(`${RESOURCES[item.resource].label}「${item.label}」`);
  }
  return failed;
};

export const applyExtraction = async (actor: Actor, id: string, body: unknown): Promise<ImportResult<ExtractionResponse>> => {
  const admin = createAdminClient();
  const found = await readExtraction(actor, id, admin);
  if (!found) return { ok: false, status: 404, error: '読取りの結果が見つかりません' };
  if (found.row.status !== 'extracted') {
    return { ok: false, status: 409, error: found.row.status === 'applied' ? 'この読取りの結果は、すでに台帳に反映されています' : 'この読取りの結果は破棄されています' };
  }
  const kind = found.result.documentKind;

  const state = parseApplyPayload(kind, body);
  if (!state) return { ok: false, status: 400, error: '入力内容が不正です' };

  // 画面で見ていた台帳ではなく、今の台帳で確かめ直す
  const context = await loadImportContext(actor, admin);
  const check = checkReview(kind, state, context);
  if (check.errorCount > 0) {
    return { ok: false, status: 400, error: firstReviewError(kind, check) ?? '入力内容を確かめてください', rowIssues: check.rows };
  }
  const plan = planApply(kind, state);
  if (!plan.ok) return { ok: false, status: 400, error: plan.error };

  // 同じ読取りを 2 回反映させない: 状態を変えられた 1 回だけが先へ進む
  const appliedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('document_extractions')
    .update({ status: 'applied', appliedByUserId: actor.id, appliedAt })
    .eq('organizationId', actor.organizationId)
    .eq('id', id)
    .eq('status', 'extracted')
    .select('id');
  if (claimError) return { ok: false, status: 500, error: '反映を始められませんでした。時間をおいてお試しください' };
  if ((claimed ?? []).length === 0) return { ok: false, status: 409, error: 'この読取りの結果は、すでに反映または破棄されています' };

  const release = () =>
    admin
      .from('document_extractions')
      .update({ status: 'extracted', appliedByUserId: null, appliedAt: null })
      .eq('organizationId', actor.organizationId)
      .eq('id', id);

  const provenance = `AI 取り込み（文書: ${found.document.title}）`.slice(0, PROVENANCE_MAX);
  const created: Created[] = [];
  const ids = new Map<string, string>();
  const names = new Map(context.stakeholders.map((row) => [row.id, row.label]));
  let companyFields: { key: string; label: string }[] = [];
  let failure: string | null = null;

  try {
    for (const step of plan.steps) {
      if (step.action === 'company') {
        const result = await companyStep(actor, kind, step, context, admin);
        if (!result.ok) {
          failure = result.error;
          break;
        }
        companyFields = result.fields;
        continue;
      }
      const result =
        step.action === 'transfer'
          ? await transferStep(actor, kind, step, ids, names, provenance, admin)
          : await createStep(actor, kind, step, ids, provenance, admin);
      if (!result.ok) {
        failure = result.error;
        break;
      }
      for (const item of result.created) {
        created.push(item);
        ids.set(item.rowKey, item.id);
        if (item.resource === 'stakeholders') names.set(item.id, item.label);
      }
    }
  } catch {
    failure = '台帳への書き込みの途中でエラーが起きました';
  }

  if (failure) {
    const leftovers = await rollback(actor, created, admin);
    await release();
    await recordAudit(admin, actor, 'import.apply_failed', 'document_extractions', id, { error: failure, rolledBack: created.length - leftovers.length, leftovers });
    return {
      ok: false,
      status: leftovers.length > 0 ? 500 : 400,
      error:
        leftovers.length > 0
          ? `${failure}。途中まで作った行の取り消しにも失敗し、次の行が残っています: ${leftovers.join('、')}。各画面で削除してから、もう一度反映してください`
          : `${failure}（台帳は反映の前の状態に戻しました）`,
      code: leftovers.length > 0 ? 'rollback_failed' : 'apply_failed',
    };
  }

  // 文書を、主なレコード（ラウンド・回次・会議・決算。無ければ最初に作った株主）に関連づける
  const primary =
    DOCUMENT_LINK_TARGETS.map((target) => ({ entityType: target.entityType, item: created.find((item) => item.group === target.group) })).find((entry) => entry.item) ??
    { entityType: 'stakeholder', item: created.find((item) => item.group === 'stakeholders') };
  const documentLink = primary.item ? { entityType: primary.entityType, entityId: primary.item.id } : null;
  if (documentLink && !found.document.entityId) {
    await admin.from('documents').update(documentLink).eq('organizationId', actor.organizationId).eq('id', found.document.id);
  }

  const groups = [...new Set(created.map((item) => item.group))];
  const appliedSummary: AppliedSummary = {
    created: groups.map((group) => {
      const items = created.filter((item) => item.group === group);
      return {
        group,
        resource: items[0].resource,
        label: resourceDefOf(GROUP_SPECS[group])?.label ?? GROUP_SPECS[group].label,
        items: items.map((item) => ({ id: item.id, label: item.label, ...(item.href ? { href: item.href } : {}) })),
      };
    }),
    companyFields,
    documentLink,
  };
  // 台帳にはもう書いてあるので、記録の保存に失敗しても成功として返す（状態は applied のまま）
  await admin.from('document_extractions').update({ appliedSummary }).eq('organizationId', actor.organizationId).eq('id', id);
  await recordAudit(admin, actor, 'import.apply', 'document_extractions', id, {
    documentId: found.document.id,
    documentKind: kind,
    created: Object.fromEntries(appliedSummary.created.map((entry) => [entry.resource + ':' + entry.group, entry.items.map((item) => item.id)])),
    companyFields: companyFields.map((field) => field.key),
  });

  const response = await getExtraction(actor, id);
  if (!response) return { ok: false, status: 500, error: '台帳には反映しましたが、結果の読み直しに失敗しました。画面を読み込み直してください' };
  return { ok: true, data: response };
};
