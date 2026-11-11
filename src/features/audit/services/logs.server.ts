// 監査ログの読み出し（サーバ専用）。
//
// system_audit_logs は service_role でしか読めない。呼び出し側（Route Handler）が requireAuditReader で
// 権限を確かめてから、ここで必ず organizationId（profile から取る）で絞って読む。
// 並びは連番の降順。連鎖を入れる前の記録（連番なし）は、連番つきの記録のあとに、記録時刻の降順で続ける。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findAiPurpose } from '@/lib/ai/purposes';
import { isUuid } from '@/lib/resources/fields';
import type { AuditLogDetail, AuditLogItem, AuditLogRow } from '../types';
import { AUDIT_LOG_CSV_HEADER, auditLogCsvRow, CSV_BOM, toCsvLine, type AuditLogExportRow } from './csv';
import { changedColumnsOf } from './diff';
import {
  containsPattern,
  EXPORT_MAX_ROWS,
  jstRangeOf,
  quoteFilterValue,
  SYSTEM_USER_FILTER,
  type AuditCursor,
  type AuditLogFilters,
} from './filters';
import { actionsMatchingLabel, categoryActionPatterns, OTHER_CATEGORY } from './labels';

// PostgREST の 1 回の行数の上限（supabase/config.toml の max_rows = 1000）より小さくする
const EXPORT_PAGE_SIZE = 500;

const LIST_COLUMNS =
  'id, seq, createdAt, source, outcome, action, entityName, entityId, userId, actorEmail, actorRole, ipAddress, requestId, detail, oldValues, newValues';
const DETAIL_COLUMNS = `${LIST_COLUMNS}, userAgent, prevHash, hash`;
// 変更前後の値は、DB が持つ文字のまま（jsonb を text にしたもの）で取る。ハッシュの計算に入っているのがこの文字なので、
// JSON.stringify で作り直すと（空白やキーの順が変わり）CSV からハッシュを計算し直せなくなる
const EXPORT_COLUMNS =
  'id, organizationId, userId, action, entityName, entityId, detail, ipAddress, userAgent, requestId, createdAt, seq, prevHash, hash, source, outcome, actorEmail, actorRole, oldValuesText:oldValues::text, newValuesText:newValues::text';

type ListRow = Pick<
  AuditLogRow,
  | 'id'
  | 'seq'
  | 'createdAt'
  | 'source'
  | 'outcome'
  | 'action'
  | 'entityName'
  | 'entityId'
  | 'userId'
  | 'actorEmail'
  | 'actorRole'
  | 'ipAddress'
  | 'requestId'
  | 'detail'
  | 'oldValues'
  | 'newValues'
>;
type DetailRow = ListRow & Pick<AuditLogRow, 'userAgent' | 'prevHash' | 'hash'>;

// 絞り込みに使う、問い合わせの組み立ての操作（supabase-js の PostgrestFilterBuilder のうち使うものだけ）
interface FilterQuery {
  eq(column: string, value: string): this;
  is(column: string, value: null): this;
  gte(column: string, value: string): this;
  lt(column: string, value: string | number): this;
  or(filters: string): this;
  not(column: string, operator: string, value: string | null): this;
}

interface LogQuery extends FilterQuery, PromiseLike<{ data: unknown; error: unknown; count: number | null }> {
  order(column: string, options: { ascending: boolean }): this;
  limit(count: number): this;
  range(from: number, to: number): this;
}

// 読む列が場面（一覧・詳細・CSV）で変わる。supabase-js は列の文字から行の型を作るが、変数の文字では作れない
// （型の計算が終わらない）ので、ここで使う操作だけの型として扱う
const selectLogs = (admin: SupabaseClient, columns: string, options?: { count: 'exact'; head: true }): LogQuery =>
  (admin.from('system_audit_logs') as unknown as { select(columns: string, options?: object): LogQuery }).select(columns, options);

// キーワードで探す列（文字の列だけ。変更前後の値は jsonb なので対象にしない）
const KEYWORD_COLUMNS = ['action', 'detail', 'actorEmail', 'ipAddress', 'entityName'] as const;

/** 組織と絞り込みの条件を問い合わせに付ける。値はすべて parseAuditLogFilters で検証済みのもの */
export const applyAuditLogFilters = <Q extends FilterQuery>(query: Q, organizationId: string, filters: AuditLogFilters): Q => {
  let result = query.eq('organizationId', organizationId);

  const range = jstRangeOf(filters);
  if (range.since) result = result.gte('createdAt', range.since);
  if (range.before) result = result.lt('createdAt', range.before);
  if (filters.source) result = result.eq('source', filters.source);
  if (filters.outcome) result = result.eq('outcome', filters.outcome);
  if (filters.userId) result = filters.userId === SYSTEM_USER_FILTER ? result.is('userId', null) : result.eq('userId', filters.userId);
  if (filters.entityName) result = result.eq('entityName', filters.entityName);
  if (filters.entityId) result = result.eq('entityId', filters.entityId);
  if (filters.requestId) result = result.eq('requestId', filters.requestId);

  if (filters.category) {
    // LIKE のパターン（auth.%）を、PostgREST の書き方（auth.*）にする
    const patterns = categoryActionPatterns(filters.category).map((pattern) => pattern.replace(/%/g, '*'));
    if (filters.category === OTHER_CATEGORY) {
      for (const pattern of patterns) result = result.not('action', 'like', pattern);
    } else {
      result = result.or(patterns.map((pattern) => `action.like.${quoteFilterValue(pattern)}`).join(','));
    }
  }

  if (filters.q) {
    const pattern = quoteFilterValue(containsPattern(filters.q));
    const conditions = KEYWORD_COLUMNS.map((column) => `${column}.ilike.${pattern}`);
    // 画面には日本語の表示名が出ているので、表示名にキーワードを含む操作も対象にする
    const actions = actionsMatchingLabel(filters.q);
    if (actions.length > 0) conditions.push(`action.in.(${actions.map(quoteFilterValue).join(',')})`);
    result = result.or(conditions.join(','));
  }

  return result;
};

export class AuditLogQueryError extends Error {
  constructor(message = '監査ログの取得に失敗しました') {
    super(message);
    this.name = 'AuditLogQueryError';
  }
}

interface RawPage<T> {
  rows: T[];
  nextCursor: AuditCursor | null;
}

/**
 * 1 ページ分を読む。続きがあるかは、1 行多く読んで確かめる。
 * 連番なしの記録は増えも減りもしない（追加のたびに DB が連番を振り、更新・削除はできない）ので、何件目からかで続きを指す。
 */
export const fetchAuditLogRows = async <T extends { seq: number | null }>(
  admin: SupabaseClient,
  organizationId: string,
  filters: AuditLogFilters,
  cursor: AuditCursor | null,
  limit: number,
  columns: string,
): Promise<RawPage<T>> => {
  const rows: T[] = [];

  if (!cursor || cursor.kind === 'seq') {
    let query = applyAuditLogFilters(selectLogs(admin, columns), organizationId, filters).not('seq', 'is', null);
    if (cursor) query = query.lt('seq', cursor.before);
    const { data, error } = await query.order('seq', { ascending: false }).limit(limit + 1);
    if (error) throw new AuditLogQueryError();
    const sequenced = (data ?? []) as unknown as T[];
    if (sequenced.length > limit) {
      const page = sequenced.slice(0, limit);
      return { rows: page, nextCursor: { kind: 'seq', before: Number(page[page.length - 1].seq) } };
    }
    rows.push(...sequenced);
  }

  // 連番つきの記録を読み切ったら、連番なしの記録を続ける
  const offset = cursor?.kind === 'legacy' ? cursor.offset : 0;
  const remaining = limit - rows.length;
  const { data, error } = await applyAuditLogFilters(selectLogs(admin, columns), organizationId, filters)
    .is('seq', null)
    .order('createdAt', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + remaining);
  if (error) throw new AuditLogQueryError();
  const legacy = (data ?? []) as unknown as T[];
  if (legacy.length > remaining) {
    rows.push(...legacy.slice(0, remaining));
    return { rows, nextCursor: { kind: 'legacy', offset: offset + remaining } };
  }
  rows.push(...legacy);
  return { rows, nextCursor: null };
};

/** 条件に合う記録の件数 */
export const countAuditLogs = async (admin: SupabaseClient, organizationId: string, filters: AuditLogFilters): Promise<number> => {
  const { count, error } = await applyAuditLogFilters(selectLogs(admin, 'id', { count: 'exact', head: true }), organizationId, filters);
  if (error || count == null) throw new AuditLogQueryError();
  return count;
};

// ---- 操作した人・対象の名前を補う ----

// 対象の行の名前に使う列（テーブルごと）。ここに無いテーブルは名前を出さない
const LABEL_COLUMNS: Record<string, string> = {
  organizations: 'name',
  profiles: 'email',
  invites: 'email',
  fiscal_years: 'label',
  stakeholders: 'name',
  officers: 'name',
  share_classes: 'name',
  funding_rounds: 'name',
  convertible_rounds: 'name',
  option_plans: 'name',
  meetings: 'title',
  meeting_agenda_items: 'title',
  financial_reports: 'title',
  documents: 'title',
  share_links: 'label',
  shareholder_updates: 'title',
  document_templates: 'title',
};

const MAX_LABEL_LENGTH = 80;

const cleanLabel = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > MAX_LABEL_LENGTH ? `${text.slice(0, MAX_LABEL_LENGTH)}…` : text;
};

const parseDetail = (detail: string | null): Record<string, unknown> | null => {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const MAX_CHANGED_COLUMNS = 50;

/** アプリが残した「変更した項目」の名前（detail.changed）。無ければ空 */
const changedFromDetail = (detail: string | null): string[] => {
  const changed = parseDetail(detail)?.changed;
  if (!Array.isArray(changed)) return [];
  return changed.filter((value): value is string => typeof value === 'string' && value.length <= 100).slice(0, MAX_CHANGED_COLUMNS);
};

/** 記録そのものから分かる対象の名前（アプリが残した名前、または変更前後の値の中の名前の列） */
const labelFromRow = (row: ListRow): string | null => {
  if (row.action === 'ai.request') return findAiPurpose(row.entityName)?.label ?? null;
  const detail = parseDetail(row.detail);
  // アプリが残した名前（リソースの label、株主の name、出力したファイルの fileName など）
  const fromDetail = cleanLabel(detail?.label) ?? cleanLabel(detail?.name) ?? cleanLabel(detail?.title) ?? cleanLabel(detail?.fileName);
  if (fromDetail) return fromDetail;
  const column = Object.hasOwn(LABEL_COLUMNS, row.entityName) ? LABEL_COLUMNS[row.entityName] : null;
  if (!column) return null;
  return cleanLabel(row.newValues?.[column]) ?? cleanLabel(row.oldValues?.[column]);
};

/** 記録から名前が分からない対象を、いまのテーブルから引く（自組織の行だけ。消された行は引けない） */
const lookupEntityLabels = async (
  admin: SupabaseClient,
  organizationId: string,
  targets: Map<string, Set<string>>,
): Promise<Map<string, string>> => {
  const labels = new Map<string, string>();
  await Promise.all(
    [...targets].map(async ([table, ids]) => {
      const column = LABEL_COLUMNS[table];
      const query = admin.from(table).select(`id, ${column}`).in('id', [...ids]);
      // 組織の行だけは organizationId の列を持たない（id が組織の id）
      const { data, error } = await (table === 'organizations' ? query.eq('id', organizationId) : query.eq('organizationId', organizationId));
      // 名前は表示の補助なので、引けなくても一覧は返す
      if (error) return;
      for (const item of (data ?? []) as unknown as Record<string, unknown>[]) {
        const label = cleanLabel(item[column]);
        if (label && typeof item.id === 'string') labels.set(`${table}:${item.id}`, label);
      }
    }),
  );
  return labels;
};

interface ActorProfile {
  id: string;
  fullName: string | null;
  email: string | null;
}

const lookupActors = async (admin: SupabaseClient, organizationId: string, userIds: string[]): Promise<Map<string, ActorProfile>> => {
  if (userIds.length === 0) return new Map();
  const { data, error } = await admin.from('profiles').select('id, fullName, email').eq('organizationId', organizationId).in('id', userIds);
  if (error) return new Map();
  return new Map(((data ?? []) as ActorProfile[]).map((profile) => [profile.id, profile]));
};

const toItem = (row: ListRow, actors: Map<string, ActorProfile>, entityLabel: string | null): AuditLogItem => {
  const actor = row.userId ? actors.get(row.userId) : undefined;
  // 連鎖を入れる前の記録には、当時のメールアドレスが残っていない。いまの登録から補う
  const actorEmail = row.actorEmail ?? actor?.email ?? null;
  return {
    id: row.id,
    seq: row.seq == null ? null : Number(row.seq),
    createdAt: row.createdAt,
    source: row.source,
    outcome: row.outcome,
    action: row.action,
    entityName: row.entityName,
    entityId: row.entityId,
    entityLabel,
    userId: row.userId,
    actorName: actor?.fullName?.trim() || null,
    actorEmail,
    actorRole: row.actorRole,
    ipAddress: row.ipAddress,
    requestId: row.requestId,
    // 「変更した項目」は更新の記録だけ（追加・削除は行の全体が入っているので、項目の一覧にしない）。
    // アプリの操作の記録は、アプリが残した項目の名前（detail.changed）を使う
    changedColumns: row.oldValues && row.newValues ? changedColumnsOf(row.oldValues, row.newValues) : changedFromDetail(row.detail),
  };
};

const decorate = async <T extends ListRow>(
  admin: SupabaseClient,
  organizationId: string,
  rows: T[],
): Promise<{ row: T; item: AuditLogItem }[]> => {
  const known = rows.map(labelFromRow);
  const targets = new Map<string, Set<string>>();
  rows.forEach((row, index) => {
    if (known[index] || !row.entityId || !isUuid(row.entityId) || !Object.hasOwn(LABEL_COLUMNS, row.entityName)) return;
    if (!targets.has(row.entityName)) targets.set(row.entityName, new Set());
    targets.get(row.entityName)?.add(row.entityId);
  });
  const userIds = [...new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id)))];
  const [lookedUp, actors] = await Promise.all([
    lookupEntityLabels(admin, organizationId, targets),
    lookupActors(admin, organizationId, userIds),
  ]);
  return rows.map((row, index) => ({
    row,
    item: toItem(row, actors, known[index] ?? lookedUp.get(`${row.entityName}:${row.entityId}`) ?? null),
  }));
};

/** 一覧の 1 ページ */
export const listAuditLogs = async (
  admin: SupabaseClient,
  organizationId: string,
  filters: AuditLogFilters,
  cursor: AuditCursor | null,
  limit: number,
): Promise<{ items: AuditLogItem[]; nextCursor: AuditCursor | null }> => {
  const page = await fetchAuditLogRows<ListRow>(admin, organizationId, filters, cursor, limit, LIST_COLUMNS);
  const decorated = await decorate(admin, organizationId, page.rows);
  return { items: decorated.map((entry) => entry.item), nextCursor: page.nextCursor };
};

/** 1 行のすべての項目。自組織の記録でなければ null */
export const getAuditLogDetail = async (admin: SupabaseClient, organizationId: string, id: string): Promise<AuditLogDetail | null> => {
  if (!isUuid(id)) return null;
  const { data, error } = await selectLogs(admin, DETAIL_COLUMNS).eq('organizationId', organizationId).eq('id', id).limit(1);
  if (error) throw new AuditLogQueryError();
  const [row] = (data ?? []) as DetailRow[];
  if (!row) return null;
  const [{ item }] = await decorate(admin, organizationId, [row]);
  return {
    ...item,
    detail: row.detail,
    userAgent: row.userAgent,
    prevHash: row.prevHash,
    hash: row.hash,
    oldValues: row.oldValues,
    newValues: row.newValues,
  };
};

// ---- CSV の出力 ----

export interface AuditLogExport {
  /** CSV の本文（UTF-8。ページごとのかたまり） */
  chunks: Uint8Array[];
  byteLength: number;
  /** 出力した行数（見出しを除く） */
  rowCount: number;
  /** 条件に合う記録の件数（出力を始めた時点） */
  totalCount: number;
  /** 上限で打ち切ったか */
  truncated: boolean;
  /** 出力した中でいちばん新しい連番と、そのハッシュ（連番つきの記録が無ければ null） */
  lastSeq: number | null;
  lastHash: string | null;
  /** 出力した中でいちばん古い連番 */
  firstSeq: number | null;
}

/**
 * 条件に合う記録を、新しい順に最大 maxRows 行まで CSV にする。
 * テーブルを一度に読まず、ページごとに読んで UTF-8 のかたまりにしていく（メモリに持つのは CSV の本文だけ）。
 */
export const exportAuditLogs = async (
  admin: SupabaseClient,
  organizationId: string,
  filters: AuditLogFilters,
  maxRows: number = EXPORT_MAX_ROWS,
): Promise<AuditLogExport> => {
  const totalCount = await countAuditLogs(admin, organizationId, filters);
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [encoder.encode(CSV_BOM + toCsvLine(AUDIT_LOG_CSV_HEADER))];

  let rowCount = 0;
  let lastSeq: number | null = null;
  let lastHash: string | null = null;
  let firstSeq: number | null = null;
  let cursor: AuditCursor | null = null;
  let hasMore = true;

  while (hasMore && rowCount < maxRows) {
    const page: RawPage<AuditLogExportRow> = await fetchAuditLogRows<AuditLogExportRow>(
      admin,
      organizationId,
      filters,
      cursor,
      Math.min(EXPORT_PAGE_SIZE, maxRows - rowCount),
      EXPORT_COLUMNS,
    );
    if (page.rows.length > 0) {
      chunks.push(encoder.encode(page.rows.map((row) => toCsvLine(auditLogCsvRow(row))).join('')));
      rowCount += page.rows.length;
      for (const row of page.rows) {
        if (row.seq == null) continue;
        const seq = Number(row.seq);
        if (lastSeq == null || seq > lastSeq) {
          lastSeq = seq;
          lastHash = row.hash;
        }
        if (firstSeq == null || seq < firstSeq) firstSeq = seq;
      }
    }
    cursor = page.nextCursor;
    hasMore = cursor != null;
  }

  // 記録は増えることはあっても減らない。数えた件数より少なく終わったら、途中で読み落としている
  // （DB の 1 回あたりの行数の上限が小さすぎる、など）ので、欠けた CSV を渡さずに失敗にする
  if (rowCount < Math.min(totalCount, maxRows)) {
    throw new AuditLogQueryError('監査ログの出力の途中で件数が合わなくなりました。時間をおいて、もう一度お試しください');
  }

  return {
    chunks,
    byteLength: chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    rowCount,
    totalCount,
    truncated: hasMore,
    lastSeq,
    lastHash,
    firstSeq,
  };
};
