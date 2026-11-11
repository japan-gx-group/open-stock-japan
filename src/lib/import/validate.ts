// AI の出力の検証（純関数。共通の入口 generateStructured の validate に渡す）。
//
// AI の出力は信じない。値は 1 つずつ確かめ、形・範囲が合わない値は null に落とす（推測で直さない）。
// 件数・文字数には上限を掛け、要る項目が読めなかった件は捨てる。いちばん外側の形が使えないときだけ null（bad_response）。

import { isValidDateText, parseNumberText } from '@/lib/equity/format';
import type { FieldDef } from '@/lib/resources/fields';
import { aiFieldsOf, groupsOfKind, type GroupSpec } from './groups';
import type { ExtractedItem, GroupKey, ImportDocumentKind, ImportExtraction, ImportValue } from './types';

const MAX_SUMMARY_LENGTH = 400;
const MAX_WARNING_LENGTH = 300;
export const MAX_WARNINGS = 12;
const MAX_NAME_LENGTH = 200;
const MAX_NUMBER = 1_000_000_000_000_000;
const YEAR_MIN = 1868;
const YEAR_MAX = 2200;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 制御文字か（改行・タブを含む） */
const isControl = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};

/** 1 行の文字。改行・タブなどの制御文字は空白にし、前後の空白を除く（全角の空白など、表記はそのまま残す）。空なら null */
export const toLineText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = Array.from(value, (char) => (isControl(char) ? ' ' : char))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
  return text === '' ? null : text.slice(0, maxLength);
};

/** 複数行の文字。改行は残し、ほかの制御文字を除く */
const toBlockText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = Array.from(value.replace(/\r\n?/g, '\n'), (char) => (char !== '\n' && isControl(char) ? '' : char))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text === '' ? null : text.slice(0, maxLength);
};

/** 'YYYY-MM-DD' の日付。暦に無い日・範囲の外の年は null */
export const toDateValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!isValidDateText(text)) return null;
  const year = Number(text.slice(0, 4));
  return year >= YEAR_MIN && year <= YEAR_MAX ? text : null;
};

const toNumberValue = (field: FieldDef, value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? parseNumberText(value) : null;
  if (parsed == null || !Number.isFinite(parsed)) return null;
  // 金額は円未満を丸める。株式数・個数などの整数は、小数なら読み違いとして捨てる
  const number = field.type === 'yen' ? Math.round(parsed) : parsed;
  if (field.type === 'integer' && !Number.isInteger(number)) return null;
  if (field.nonZero && number === 0) return null;
  const min = field.min ?? (field.type === 'percent' ? 0 : -MAX_NUMBER);
  const max = field.max ?? (field.type === 'percent' ? 100 : MAX_NUMBER);
  return number < min || number > max ? null : number;
};

/** 1 項目を、リソース定義の種類に合わせて確かめる。合わなければ null */
export const normalizeFieldValue = (field: FieldDef, value: unknown): ImportValue => {
  if (value == null) return null;
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    case 'integer':
    case 'decimal':
    case 'yen':
    case 'percent':
      return toNumberValue(field, value);
    case 'date':
      return toDateValue(value);
    case 'time':
      return typeof value === 'string' && TIME_PATTERN.test(value.trim()) ? value.trim() : null;
    case 'select': {
      // 数字で返ってきた選択肢（事業年度の開始月など）も文字にして比べる
      const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
      return field.options?.some((option) => option.value === text) ? text : null;
    }
    case 'email': {
      const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
      return text.length <= 255 && EMAIL_PATTERN.test(text) ? text : null;
    }
    case 'textarea':
      return toBlockText(value, field.maxLength ?? 20_000);
    case 'text':
      return toLineText(value, field.maxLength ?? 200);
    default:
      return null;
  }
};

const toItem = (spec: GroupSpec, kind: ImportDocumentKind, value: unknown): ExtractedItem | null => {
  if (!isRecord(value)) return null;
  const item: ExtractedItem = {};
  for (const ref of spec.refs) {
    if (ref.nameKey) item[ref.nameKey] = toLineText(value[ref.nameKey], MAX_NAME_LENGTH);
  }
  for (const field of aiFieldsOf(spec, kind)) item[field.key] = normalizeFieldValue(field, value[field.key]);
  if (spec.requiredKeys.some((key) => item[key] == null)) return null;
  // 何も読めなかった件（すべて null）は提案にしない
  return Object.values(item).some((entry) => entry != null) ? item : null;
};

const toItems = (spec: GroupSpec, kind: ImportDocumentKind, value: unknown, warnings: string[]): ExtractedItem[] => {
  const source = spec.single ? (isRecord(value) ? [value] : []) : Array.isArray(value) ? value : [];
  if (source.length > spec.maxItems) {
    warnings.push(`${spec.label}が ${spec.maxItems} 件を超えたため、先頭の ${spec.maxItems} 件だけを読み取りました`);
  }
  const items = source
    .slice(0, spec.maxItems)
    .map((entry) => toItem(spec, kind, entry))
    .filter((item): item is ExtractedItem => item !== null);
  const dropped = Math.min(source.length, spec.maxItems) - items.length;
  if (dropped > 0 && !spec.single) warnings.push(`${spec.label}のうち ${dropped} 件は、必要な項目が読み取れなかったため除きました`);
  return items;
};

/** 同じ名前の件を 1 つにまとめる（株主・株式の種類。先に出た件を残し、欠けた項目だけを後の件で補う） */
const mergeByName = (items: ExtractedItem[]): ExtractedItem[] => {
  const byName = new Map<string, ExtractedItem>();
  for (const item of items) {
    const key = String(item.name ?? '').normalize('NFKC').replace(/\s/g, '');
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...item });
      continue;
    }
    for (const [field, value] of Object.entries(item)) {
      if (existing[field] == null && value != null) existing[field] = value;
    }
  }
  return [...byName.values()];
};

const MERGED_GROUPS: readonly GroupKey[] = ['stakeholders', 'shareClasses'];

/**
 * 文書の種類ごとの検証の関数を返す。いちばん外側がオブジェクトでなければ null。
 * まとまりの形が違う（配列のはずがオブジェクトなど）ときは、そのまとまりを空として扱う。
 */
export const validateExtraction =
  (kind: ImportDocumentKind) =>
  (value: unknown): ImportExtraction | null => {
    if (!isRecord(value)) return null;
    const specs = groupsOfKind(kind);
    // まとまりが 1 つも返っていない出力は、形が違うものとして使わない
    if (!specs.some((spec) => spec.key in value)) return null;

    const warnings = (Array.isArray(value.warnings) ? value.warnings : [])
      .map((warning) => toLineText(warning, MAX_WARNING_LENGTH))
      .filter((warning): warning is string => warning !== null)
      .slice(0, 8);

    const groups: ImportExtraction['groups'] = {};
    for (const spec of specs) {
      const items = toItems(spec, kind, value[spec.key], warnings);
      groups[spec.key] = MERGED_GROUPS.includes(spec.key) ? mergeByName(items) : items;
    }
    if (Object.values(groups).every((items) => (items ?? []).length === 0)) {
      warnings.push('この文書から読み取れる項目がありませんでした。文書の種類が合っているか確かめてください');
    }

    return {
      documentKind: kind,
      summary: toLineText(value.summary, MAX_SUMMARY_LENGTH) ?? '',
      documentDate: toDateValue(value.documentDate),
      warnings: warnings.slice(0, MAX_WARNINGS),
      groups,
    };
  };

/** 保存済みの結果（document_extractions.result）を読み直すときの確認。壊れていれば null */
export const parseStoredExtraction = (value: unknown): ImportExtraction | null => {
  if (!isRecord(value) || !isRecord(value.groups)) return null;
  const kind = value.documentKind as ImportDocumentKind;
  let specs: GroupSpec[];
  try {
    specs = groupsOfKind(kind);
  } catch {
    return null;
  }
  // 保存した形（groups の下に配列）を、AI の出力と同じ検証に通し直す（項目の定義が変わっていても安全に読めるように）
  const flat: Record<string, unknown> = { summary: value.summary, documentDate: value.documentDate, warnings: [] };
  for (const spec of specs) {
    const items = (value.groups as Record<string, unknown>)[spec.key];
    flat[spec.key] = spec.single ? (Array.isArray(items) ? items[0] : undefined) : Array.isArray(items) ? items : [];
    if (spec.single && flat[spec.key] === undefined) flat[spec.key] = {};
  }
  const parsed = validateExtraction(kind)(flat);
  if (!parsed) return null;
  const stored = (Array.isArray(value.warnings) ? value.warnings : [])
    .map((warning) => toLineText(warning, MAX_WARNING_LENGTH))
    .filter((warning): warning is string => warning !== null);
  return { ...parsed, warnings: stored.slice(0, MAX_WARNINGS) };
};
