// リソース定義の型と、入力の検証。サーバ依存なし（API・フォーム・AI 補助が同じ定義を使う）。
//
// 1 つのリソース定義（ResourceDef）から次の 3 つが決まる:
//   - サーバでの入力の検証と保存する列（parseResourceInput）
//   - 入力フォームの項目（src/components/resource/ResourceFormDialog.client.tsx）
//   - AI 補助が返す値の形（src/lib/resources/aiSchema.ts）
// 項目を足すときは definitions.ts の定義に 1 行足せば、この 3 つに反映される。

import { isValidDateText, parseNumberText } from '@/lib/equity/format';
import type { Option } from '@/lib/equity/types';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'integer'
  | 'decimal'
  | 'yen'
  /** 画面は %（20）、保存は率（0.2） */
  | 'percent'
  | 'date'
  | 'time'
  | 'select'
  | 'boolean'
  /** 他のリソースの行への参照（uuid） */
  | 'ref';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: readonly Option[];
  /** type: 'ref' の参照先（リソース名） */
  ref?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  /** 文字の項目で、空のとき null を保存する（列が null を許す場合）。指定しなければ空文字を保存する */
  nullable?: boolean;
  /** 0 を許さない（株式数など） */
  nonZero?: boolean;
  /** 新規作成時の初期値（フォームの表示値） */
  defaultValue?: string | boolean;
  /** 入力欄の下に出す説明 */
  help?: string;
  placeholder?: string;
  /** AI 補助への補足（項目名だけでは意味が伝わらないとき） */
  aiHint?: string;
  /** AI 補助の対象にしない（参照・内部用の項目など） */
  aiSkip?: boolean;
  /** 入力欄の幅。half は 2 列の片側、full は 1 行 */
  width?: 'half' | 'full';
  /** 作成後は変更できない（親への参照など） */
  immutable?: boolean;
  /** フォームに出さない（サーバが決める、または別の操作で変える） */
  hidden?: boolean;
  /** 一覧 API の絞り込みに使える（?key=value） */
  filterable?: boolean;
}

export type FieldValue = string | number | boolean | null;
export type ResourceValues = Record<string, FieldValue>;
export type ResourceRow = ResourceValues & { id: string; createdAt?: string; updatedAt?: string };

export interface ResourceDef {
  /** URL に使う名前（kebab-case） */
  name: string;
  table: string;
  /** 画面とメッセージに使う日本語名 */
  label: string;
  fields: readonly FieldDef[];
  orderBy: readonly { column: string; ascending: boolean }[];
  /** 参照の選択肢や監査ログに使う表示名 */
  labelOf: (row: ResourceValues) => string;
  /** 項目をまたぐ検証。問題があれば { 項目名: メッセージ } を返す */
  validate?: (values: ResourceValues) => Record<string, string> | null;
  /** 項目ではないが一覧で返す列（サーバが決める値） */
  readOnlyColumns?: readonly string[];
  /** フォームの上に出す説明（法令上の注意など） */
  formNote?: string;
}

const MAX_SAFE = 1_000_000_000_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

type FieldParse = { ok: true; value: FieldValue } | { ok: false; error: string };

const parseNumber = (field: FieldDef, raw: unknown): FieldParse => {
  const parsed = parseNumberText(typeof raw === 'number' ? raw : textOf(raw));
  if (parsed == null) return { ok: false, error: `${field.label}を数値で入力してください` };
  const integer = field.type === 'integer' || field.type === 'yen';
  if (integer && !Number.isInteger(parsed)) return { ok: false, error: `${field.label}は整数で入力してください` };
  if (field.nonZero && parsed === 0) return { ok: false, error: `${field.label}に 0 は指定できません` };
  const min = field.min ?? (field.type === 'percent' ? 0 : -MAX_SAFE);
  const max = field.max ?? (field.type === 'percent' ? 100 : MAX_SAFE);
  if (parsed < min) return { ok: false, error: `${field.label}は${min.toLocaleString('ja-JP')}以上で入力してください` };
  if (parsed > max) return { ok: false, error: `${field.label}は${max.toLocaleString('ja-JP')}以下で入力してください` };
  if (field.type === 'percent') return { ok: true, value: Math.round(parsed * 100) / 10_000 };
  return { ok: true, value: parsed };
};

/** 1 項目を検証して、DB に保存する値にする */
export const parseFieldValue = (field: FieldDef, raw: unknown): FieldParse => {
  if (field.type === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    const text = textOf(raw);
    if (text === 'true') return { ok: true, value: true };
    if (text === 'false' || text === '') return { ok: true, value: false };
    return { ok: false, error: `${field.label}の値が正しくありません` };
  }

  const text = textOf(raw);
  if (text === '') {
    if (field.required) {
      return { ok: false, error: `${field.label}を${field.type === 'select' || field.type === 'ref' ? '選択' : '入力'}してください` };
    }
    // 文字の項目は空文字（列が not null default ''）。nullable を付けた項目と、文字以外は null
    const isText = field.type === 'text' || field.type === 'textarea';
    return { ok: true, value: isText && !field.nullable ? '' : null };
  }

  switch (field.type) {
    case 'text':
    case 'textarea': {
      const max = field.maxLength ?? (field.type === 'text' ? 200 : 20_000);
      if (text.length > max) return { ok: false, error: `${field.label}は${max.toLocaleString('ja-JP')}文字以内で入力してください` };
      return { ok: true, value: text };
    }
    case 'email':
      if (text.length > 255 || !EMAIL_PATTERN.test(text)) return { ok: false, error: `${field.label}の形式が正しくありません` };
      return { ok: true, value: text.toLowerCase() };
    case 'integer':
    case 'decimal':
    case 'yen':
    case 'percent':
      return parseNumber(field, raw);
    case 'date':
      if (!isValidDateText(text)) return { ok: false, error: `${field.label}を正しい日付で入力してください` };
      return { ok: true, value: text };
    case 'time':
      if (!TIME_PATTERN.test(text)) return { ok: false, error: `${field.label}は 13:30 の形で入力してください` };
      return { ok: true, value: text };
    case 'select':
      if (!field.options?.some((option) => option.value === text)) return { ok: false, error: `${field.label}を選択してください` };
      return { ok: true, value: text };
    case 'ref':
      if (!isUuid(text)) return { ok: false, error: `${field.label}を選択してください` };
      return { ok: true, value: text };
    default:
      return { ok: false, error: `${field.label}の種類が正しくありません` };
  }
};

export type ResourceParse =
  | { ok: true; values: ResourceValues }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

/**
 * リクエストの本文を検証して、保存する値にする。
 * mode: 'create' は全項目、'update' は immutable の項目を除く全項目（送られなかった項目は空として扱う = 全体の置き換え）。
 */
export const parseResourceInput = (def: ResourceDef, raw: unknown, mode: 'create' | 'update'): ResourceParse => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '入力内容が不正です', fieldErrors: {} };
  }
  const body = raw as Record<string, unknown>;
  const values: ResourceValues = {};
  const fieldErrors: Record<string, string> = {};

  for (const field of def.fields) {
    if (mode === 'update' && field.immutable) continue;
    // フォームに出さない項目は、送られたときだけ検証して保存する（未送信なら DB の値を保つ）
    if (field.hidden && !(field.key in body)) continue;
    const parsed = parseFieldValue(field, body[field.key]);
    if (parsed.ok) values[field.key] = parsed.value;
    else fieldErrors[field.key] = parsed.error;
  }

  if (Object.keys(fieldErrors).length === 0 && def.validate) {
    Object.assign(fieldErrors, def.validate(values) ?? {});
  }
  const firstError = Object.values(fieldErrors)[0];
  if (firstError) return { ok: false, error: firstError, fieldErrors };
  return { ok: true, values };
};

/** DB の値をフォームの表示値にする（数値は文字列、率は %） */
export const toFormValue = (field: FieldDef, value: unknown): string | boolean => {
  if (field.type === 'boolean') return value === true;
  if (value == null) return '';
  if (field.type === 'percent') return String(Math.round(Number(value) * 10_000) / 100);
  if (field.type === 'yen' || field.type === 'integer') {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('ja-JP') : '';
  }
  return String(value);
};

export const emptyFormValue = (field: FieldDef): string | boolean =>
  field.defaultValue ?? (field.type === 'boolean' ? false : '');

/** PostgREST が文字列で返すことのある数値列を number にそろえる */
export const normalizeRow = (def: ResourceDef, row: Record<string, unknown>): ResourceRow => {
  const normalized: Record<string, unknown> = { ...row };
  for (const field of def.fields) {
    const value = normalized[field.key];
    if (value == null) continue;
    if (field.type === 'integer' || field.type === 'decimal' || field.type === 'yen' || field.type === 'percent') {
      const number = Number(value);
      normalized[field.key] = Number.isFinite(number) ? number : null;
    }
  }
  return normalized as ResourceRow;
};
