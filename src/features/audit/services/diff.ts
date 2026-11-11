// 変更前後の値（oldValues / newValues）を、項目の日本語名つきの表にする。サーバ依存なしの純粋な関数。
//
// DB のトリガーが残す値の形:
//   追加 … newValues に行の全体 / 削除 … oldValues に行の全体 / 更新 … 変わった列だけを両方に
//   秘密の値は「（秘匿）」、長い値は { omitted: true, length, sha256 } に置き換えられている
// 項目の名前は、リソース定義（src/lib/resources/definitions.ts）から引く。定義に無い列は下の表、
// それにも無ければ列の名前をそのまま出す（列が増えても画面が壊れない）。

import type { Option } from '@/lib/equity/types';
import { COMPANY_DEF } from '@/lib/resources/company';
import { DOCUMENT_CATEGORIES, DOCUMENT_VISIBILITIES, RESOURCES } from '@/lib/resources/definitions';
import type { FieldDef, FieldType } from '@/lib/resources/fields';
import { MEMBER_ROLES, memberRoleLabel } from '@/types/role';

interface ColumnInfo {
  label: string;
  type?: FieldType;
  options?: readonly Option[];
}

const ROLE_OPTIONS: readonly Option[] = MEMBER_ROLES.map((role) => ({ value: role, label: memberRoleLabel(role) }));

// どのテーブルにもある列・複数のテーブルで同じ意味の列
const COMMON_COLUMNS: Record<string, ColumnInfo> = {
  id: { label: 'ID' },
  organizationId: { label: '組織のID' },
  createdAt: { label: '作成日時' },
  updatedAt: { label: '更新日時' },
  publishedAt: { label: '公開日時' },
  notes: { label: 'メモ' },
  stakeholderId: { label: '株主・権利者' },
  documentId: { label: '文書' },
  meetingId: { label: '会議' },
  groupId: { label: 'まとめて記録した異動の番号' },
  createdByUserId: { label: '作成した人' },
  updatedByUserId: { label: '更新した人' },
  updatedBy: { label: '更新した人' },
  uploadedByUserId: { label: 'アップロードした人' },
  invitedByUserId: { label: '招待した人' },
  appliedByUserId: { label: '反映した人' },
};

// リソース定義に無いテーブルの列
const EXTRA_COLUMNS: Record<string, Record<string, ColumnInfo>> = {
  profiles: {
    email: { label: 'メールアドレス' },
    fullName: { label: '氏名' },
    role: { label: 'ロール', type: 'select', options: ROLE_OPTIONS },
    phone: { label: '電話番号' },
    stakeholderId: { label: '紐づく株主・権利者' },
  },
  invites: {
    token: { label: '招待リンクの秘密' },
    email: { label: 'メールアドレス' },
    role: { label: 'ロール', type: 'select', options: ROLE_OPTIONS },
    expiresAt: { label: '有効期限' },
    acceptedAt: { label: '受け取った日時' },
    stakeholderId: { label: '紐づく株主・権利者' },
  },
  documents: {
    title: { label: 'タイトル' },
    category: { label: '分類', type: 'select', options: DOCUMENT_CATEGORIES },
    description: { label: '説明' },
    documentDate: { label: '文書の日付' },
    visibility: { label: '公開範囲', type: 'select', options: DOCUMENT_VISIBILITIES },
    storagePath: { label: '保存先' },
    fileName: { label: 'ファイル名' },
    mimeType: { label: 'ファイルの種類' },
    sizeBytes: { label: 'サイズ（バイト）' },
    sha256: { label: 'ファイルのハッシュ（SHA-256）' },
    entityType: { label: '関連するレコードの種類' },
    entityId: { label: '関連するレコード' },
  },
  share_links: {
    label: { label: '名前' },
    tokenHash: { label: 'リンクの秘密（ハッシュ）' },
    expiresAt: { label: '有効期限' },
    revokedAt: { label: '無効にした日時' },
    accessCount: { label: 'アクセスの回数' },
    lastAccessedAt: { label: '最後のアクセス' },
  },
  ai_settings: {
    provider: { label: 'AI の提供元' },
    modelId: { label: 'モデル' },
  },
  ai_credentials: {
    provider: { label: 'AI の提供元' },
    ciphertext: { label: 'API キー（暗号文）' },
    iv: { label: '暗号の初期化ベクトル' },
    authTag: { label: '暗号の認証タグ' },
    keyId: { label: '暗号鍵の番号' },
    keyLast4: { label: 'API キーの末尾 4 文字' },
  },
  document_extractions: {
    documentKind: { label: '文書の種類' },
    status: { label: '状態' },
    provider: { label: 'AI の提供元' },
    modelId: { label: 'モデル' },
    result: { label: '読み取り結果' },
    appliedSummary: { label: '反映した内容' },
    appliedAt: { label: '反映した日時' },
  },
  compliance_task_states: {
    taskKey: { label: '手続き' },
    completedOn: { label: '完了した日' },
    note: { label: 'メモ' },
  },
};

const fromField = (field: FieldDef): ColumnInfo => ({ label: field.label, type: field.type, options: field.options });

// テーブル名 → 列名 → 項目（リソース定義から作る。列の並びは定義の順）
const DEFINED_COLUMNS: Record<string, Record<string, ColumnInfo>> = Object.fromEntries(
  [...Object.values(RESOURCES), COMPANY_DEF].map((def) => [
    def.table,
    Object.fromEntries(def.fields.map((field) => [field.key, fromField(field)])),
  ]),
);

const SYSTEM_COLUMNS = ['id', 'organizationId', 'createdAt', 'updatedAt'];

const columnsOfTable = (table: string): Record<string, ColumnInfo> => ({
  ...(Object.hasOwn(EXTRA_COLUMNS, table) ? EXTRA_COLUMNS[table] : {}),
  ...(Object.hasOwn(DEFINED_COLUMNS, table) ? DEFINED_COLUMNS[table] : {}),
});

const findColumn = (table: string, column: string): ColumnInfo | null => {
  const columns = columnsOfTable(table);
  if (Object.hasOwn(columns, column)) return columns[column];
  return Object.hasOwn(COMMON_COLUMNS, column) ? COMMON_COLUMNS[column] : null;
};

/** 列の日本語名。分からなければ列の名前をそのまま返す */
export const columnLabel = (table: string, column: string): string => findColumn(table, column)?.label ?? column;

export const EMPTY_VALUE_LABEL = '（空）';

const isOmittedMarker = (value: object): value is { omitted: true; length: number; sha256: string } =>
  (value as { omitted?: unknown }).omitted === true && typeof (value as { sha256?: unknown }).sha256 === 'string';

/** 値を画面に出す文字にする。選択肢の項目は「表示名（保存されている値）」の形にする */
export const formatAuditValue = (value: unknown, column?: ColumnInfo | null): string => {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE_LABEL;
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
  if (typeof value === 'number') {
    // 率は保存の値（0.2）だけだと読みにくいので、% を添える
    if (column?.type === 'percent') return `${Math.round(value * 1_000_000) / 10_000}%（${value}）`;
    return String(value);
  }
  if (typeof value === 'string') {
    const option = column?.options?.find((item) => item.value === value);
    return option ? `${option.label}（${value}）` : value;
  }
  if (typeof value === 'object') {
    if (isOmittedMarker(value)) {
      const length = Number(value.length);
      return `（長い値のため記録を省略。${Number.isFinite(length) ? length.toLocaleString('ja-JP') : '?'} 文字・SHA-256: ${value.sha256}）`;
    }
    return JSON.stringify(value);
  }
  return String(value);
};

export type AuditDiffKind = 'insert' | 'update' | 'delete';

export interface AuditDiffRow {
  column: string;
  label: string;
  /** 変更前の値。追加の記録（変更前が無い）では null */
  before: string | null;
  /** 変更後の値。削除の記録（変更後が無い）では null */
  after: string | null;
}

export interface AuditDiff {
  kind: AuditDiffKind;
  rows: AuditDiffRow[];
}

type Values = Record<string, unknown> | null | undefined;

const isRecord = (value: Values): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

/** 列の並び: リソース定義の順 → 定義に無い列（名前順）→ 管理用の列（id・作成日時など） */
const orderColumns = (table: string, columns: string[]): string[] => {
  const defined = Object.keys(columnsOfTable(table));
  const rank = (column: string): number => {
    const system = SYSTEM_COLUMNS.indexOf(column);
    if (system >= 0) return 20_000 + system;
    const index = defined.indexOf(column);
    return index >= 0 ? index : 10_000;
  };
  return [...columns].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
};

/**
 * 変更前後の値を、項目ごとの行にする。どちらも無ければ null。
 * 更新の記録は変わった列だけが入っているので、そのまま全部の行を出す。
 */
export const buildAuditDiff = (table: string, oldValues: Values, newValues: Values): AuditDiff | null => {
  const before = isRecord(oldValues) ? oldValues : null;
  const after = isRecord(newValues) ? newValues : null;
  if (!before && !after) return null;

  const kind: AuditDiffKind = !before ? 'insert' : !after ? 'delete' : 'update';
  const columns = orderColumns(table, [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]);
  const rows = columns.map((column): AuditDiffRow => {
    const info = findColumn(table, column);
    return {
      column,
      label: info?.label ?? column,
      before: before ? formatAuditValue(before[column], info) : null,
      after: after ? formatAuditValue(after[column], info) : null,
    };
  });
  return { kind, rows };
};

/** 変更前後の値に入っている列の名前（一覧の「変更した項目」に使う。管理用の列は除く） */
export const changedColumnsOf = (oldValues: Values, newValues: Values): string[] => {
  const columns = new Set([...Object.keys(isRecord(oldValues) ? oldValues : {}), ...Object.keys(isRecord(newValues) ? newValues : {})]);
  return [...columns].filter((column) => !SYSTEM_COLUMNS.includes(column));
};

/** 列の名前を日本語名にして並べる（多いときは先頭だけ出して「ほか n 項目」） */
export const summarizeColumns = (table: string, columns: readonly string[], max = 3): string => {
  if (columns.length === 0) return '';
  const ordered = orderColumns(table, [...columns]);
  const labels = ordered.slice(0, max).map((column) => columnLabel(table, column));
  const rest = ordered.length - labels.length;
  return rest > 0 ? `${labels.join('、')} ほか ${rest} 項目` : labels.join('、');
};

/** 詳細（detail。JSON の文字）を読みやすい形にする。JSON でなければそのまま返す */
export const formatDetailText = (detail: string | null | undefined): string => {
  if (!detail) return '';
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
};
