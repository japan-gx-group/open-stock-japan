// 監査ログの絞り込みの条件。サーバ依存なし（API の入力の検証と、画面が URL を組み立てるのに使う）。
//
// 期間は日本時間の日付で受け取り、その日の 0:00 から、終わりの日の 24:00 まで（終わりの日を含む）を対象にする。
// 並びは連番の降順。続きは「この連番より前」を cursor で指定する（連鎖を入れる前の記録は、連番つきの記録のあとに続く）。

import { addDays, isValidDateText } from '@/lib/equity/format';
import { isUuid } from '@/lib/resources/fields';
import { AUDIT_OUTCOMES, AUDIT_SOURCES, type AuditOutcome, type AuditSource } from '../types';
import { isAuditCategory } from './labels';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_KEYWORD_LENGTH = 100;
/** CSV に出す行数の上限。これを超える条件は、期間を区切って出力してもらう */
export const EXPORT_MAX_ROWS = 50_000;

/** userId に指定すると、操作した人が決まらない記録（システムの処理など）だけにする */
export const SYSTEM_USER_FILTER = 'system';

export interface AuditLogFilters {
  /** 期間の始まり・終わり（YYYY-MM-DD。日本時間） */
  from?: string;
  to?: string;
  source?: AuditSource;
  outcome?: AuditOutcome;
  /** 操作した人の id。'system' は操作した人が決まらない記録 */
  userId?: string;
  category?: string;
  entityName?: string;
  entityId?: string;
  requestId?: string;
  /** キーワード（操作・詳細・メールアドレス・IP アドレス・対象の種類） */
  q?: string;
}

export const FILTER_KEYS = ['from', 'to', 'source', 'outcome', 'userId', 'category', 'entityName', 'entityId', 'requestId', 'q'] as const;

/** 続きの位置。seq は「この連番より前」、legacyOffset は連番の無い記録の何件目からか */
export type AuditCursor = { kind: 'seq'; before: number } | { kind: 'legacy'; offset: number };

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ENTITY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
// リクエストの番号は、表示できる ASCII だけ（src/lib/audit/headers.ts が入れる値と同じ範囲）
const REQUEST_ID_PATTERN = /^[\x21-\x7e]{1,100}$/;
const SEQ_CURSOR_PATTERN = /^[1-9]\d{0,14}$/;
const LEGACY_CURSOR_PATTERN = /^legacy-(0|[1-9]\d{0,8})$/;

type Query = { get(name: string): string | null };

const read = (query: Query, key: string): string => (query.get(key) ?? '').trim();

/** URL の問い合わせから、絞り込みの条件を取り出して検証する。正しくない値は 400 にする文を返す */
export const parseAuditLogFilters = (query: Query): Parsed<AuditLogFilters> => {
  const filters: AuditLogFilters = {};

  const from = read(query, 'from');
  const to = read(query, 'to');
  if (from) {
    if (!isValidDateText(from)) return { ok: false, error: '期間の始まりを正しい日付（YYYY-MM-DD）で指定してください' };
    filters.from = from;
  }
  if (to) {
    if (!isValidDateText(to)) return { ok: false, error: '期間の終わりを正しい日付（YYYY-MM-DD）で指定してください' };
    filters.to = to;
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    return { ok: false, error: '期間の始まりは、終わりより前の日付にしてください' };
  }

  const source = read(query, 'source');
  if (source) {
    if (!(AUDIT_SOURCES as readonly string[]).includes(source)) return { ok: false, error: '記録元の指定が正しくありません' };
    filters.source = source as AuditSource;
  }

  const outcome = read(query, 'outcome');
  if (outcome) {
    if (!(AUDIT_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: '結果の指定が正しくありません' };
    filters.outcome = outcome as AuditOutcome;
  }

  const userId = read(query, 'userId');
  if (userId) {
    if (userId !== SYSTEM_USER_FILTER && !isUuid(userId)) return { ok: false, error: '操作した人の指定が正しくありません' };
    filters.userId = userId === SYSTEM_USER_FILTER ? userId : userId.toLowerCase();
  }

  const category = read(query, 'category');
  if (category) {
    if (!isAuditCategory(category)) return { ok: false, error: '種類の指定が正しくありません' };
    filters.category = category;
  }

  const entityName = read(query, 'entityName');
  if (entityName) {
    if (!ENTITY_NAME_PATTERN.test(entityName)) return { ok: false, error: '対象の種類の指定が正しくありません' };
    filters.entityName = entityName;
  }

  const entityId = read(query, 'entityId');
  if (entityId) {
    if (!isUuid(entityId)) return { ok: false, error: '対象の指定が正しくありません' };
    filters.entityId = entityId.toLowerCase();
  }

  const requestId = read(query, 'requestId');
  if (requestId) {
    if (!REQUEST_ID_PATTERN.test(requestId)) return { ok: false, error: 'リクエストの番号の指定が正しくありません' };
    filters.requestId = requestId;
  }

  const q = read(query, 'q');
  if (q) {
    if (q.length > MAX_KEYWORD_LENGTH) return { ok: false, error: `キーワードは ${MAX_KEYWORD_LENGTH} 文字以内で入力してください` };
    // 制御文字は検索の対象にならない（入力の間違い）ので受け付けない
    if (/\p{Cc}/u.test(q)) return { ok: false, error: 'キーワードに使えない文字が含まれています' };
    filters.q = q;
  }

  return { ok: true, value: filters };
};

export const parsePageSize = (query: Query): Parsed<number> => {
  const raw = read(query, 'limit');
  if (!raw) return { ok: true, value: DEFAULT_PAGE_SIZE };
  if (!/^\d{1,4}$/.test(raw)) return { ok: false, error: `件数は 1〜${MAX_PAGE_SIZE} の整数で指定してください` };
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_PAGE_SIZE) return { ok: false, error: `件数は 1〜${MAX_PAGE_SIZE} の整数で指定してください` };
  return { ok: true, value: limit };
};

export const parseCursor = (query: Query): Parsed<AuditCursor | null> => {
  const raw = read(query, 'cursor');
  if (!raw) return { ok: true, value: null };
  if (SEQ_CURSOR_PATTERN.test(raw)) return { ok: true, value: { kind: 'seq', before: Number(raw) } };
  const legacy = LEGACY_CURSOR_PATTERN.exec(raw);
  if (legacy) return { ok: true, value: { kind: 'legacy', offset: Number(legacy[1]) } };
  return { ok: false, error: '続きの位置（cursor）の指定が正しくありません' };
};

export const formatCursor = (cursor: AuditCursor): string =>
  cursor.kind === 'seq' ? String(cursor.before) : `legacy-${cursor.offset}`;

/**
 * 期間（日本時間の日付）を、記録時刻（UTC で保存）の範囲にする。
 * 終わりの日を含めるため、終わりは「翌日の 0:00 より前」で表す。
 */
export const jstRangeOf = (filters: Pick<AuditLogFilters, 'from' | 'to'>): { since: string | null; before: string | null } => ({
  since: filters.from ? `${filters.from}T00:00:00+09:00` : null,
  before: filters.to ? `${addDays(filters.to, 1)}T00:00:00+09:00` : null,
});

/** 画面から API を呼ぶときの問い合わせ文字列（空の条件は付けない。キーの順は固定） */
export const toQueryString = (filters: AuditLogFilters, extra: Record<string, string | number | null | undefined> = {}): string => {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  return params.toString();
};

/** 条件が 1 つでも入っているか */
export const hasAnyFilter = (filters: AuditLogFilters): boolean => FILTER_KEYS.some((key) => Boolean(filters[key]?.trim()));

/**
 * PostgREST の or=(…) に入れる値を、引用符で囲む。値の中の , . : ( ) が区切りとして読まれないようにする。
 * 引用符の中では \ と " を \ で打ち消す。
 */
export const quoteFilterValue = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * キーワードを「その文字を含む」の LIKE のパターンにする。
 * 利用者が打った % と _ は、任意の文字ではなくその文字そのものとして探す（\ で打ち消す）。
 * 前後の * は PostgREST が % に読み替える。
 */
export const containsPattern = (keyword: string): string => `*${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}*`;
