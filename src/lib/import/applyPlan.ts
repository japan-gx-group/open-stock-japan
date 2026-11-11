// 反映の受け取りと段取り（純関数）。
//
// 画面から送られた行は信じない: 形を確かめ、文書の種類にあるまとまり・確認画面に出している項目だけを残す。
// そのうえで、参照される側が先になる順に並べ、新しく作る行への参照が必ず先の手順を指すことを確かめる。
// 実際の書き込み（createResource）と取り消しは server.ts が行う。

import { APPLY_ORDER, groupsOfKind, GROUP_SPECS, reviewFieldsOf, type GroupSpec } from './groups';
import { parseRef } from './review';
import type { GroupKey, ImportDocumentKind, ReviewRow, ReviewState } from './types';

const MAX_VALUE_LENGTH = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeRow = (spec: GroupSpec, kind: ImportDocumentKind, raw: unknown): ReviewRow | null => {
  if (!isRecord(raw) || typeof raw.key !== 'string' || !new RegExp(`^${spec.key}-\\d{1,4}$`).test(raw.key)) return null;
  const fields = reviewFieldsOf(spec, kind);
  const source = isRecord(raw.values) ? raw.values : {};
  const values: Record<string, string | boolean> = {};
  for (const field of fields) {
    const value = source[field.key];
    if (field.type === 'boolean') values[field.key] = value === true;
    else if (typeof value === 'string') values[field.key] = value.slice(0, MAX_VALUE_LENGTH);
    else if (typeof value === 'number' && Number.isFinite(value)) values[field.key] = String(value);
    else values[field.key] = '';
  }
  const sourceRefs = isRecord(raw.refs) ? raw.refs : {};
  const refs: Record<string, string> = {};
  for (const ref of spec.refs) {
    const value = sourceRefs[ref.key];
    // 形の違う指定は、空にせずそのまま残して検証で止める（黙って「指定なし」にしない）
    refs[ref.key] = typeof value === 'string' ? (value === '' || parseRef(value) ? value : 'invalid') : '';
  }
  const row: ReviewRow = { key: raw.key, include: raw.include === true, values, refs, names: {}, matches: {}, existing: null, similar: [] };
  if (spec.target.type === 'company') {
    const allowed = new Set(fields.map((field) => field.key));
    row.ticked = Array.isArray(raw.ticked) ? [...new Set(raw.ticked.filter((key): key is string => typeof key === 'string' && allowed.has(key)))] : [];
  }
  return row;
};

/**
 * 画面から送られた本文（{ rows: { まとまり: 行[] } }）を、確認画面の状態の形にする。形が使えなければ null。
 * 行の表示用の情報（照合の結果など）は受け取らない。
 */
export const parseApplyPayload = (kind: ImportDocumentKind, raw: unknown): ReviewState | null => {
  if (!isRecord(raw) || !isRecord(raw.rows)) return null;
  const state: ReviewState = {};
  for (const spec of groupsOfKind(kind)) {
    const rows = raw.rows[spec.key];
    if (rows === undefined) {
      state[spec.key] = [];
      continue;
    }
    // 確認画面は、参照された名前の分だけ行を足すことがあるので、上限は読取りの上限より広く取る
    if (!Array.isArray(rows) || rows.length > spec.maxItems * 4) return null;
    const parsed: ReviewRow[] = [];
    const keys = new Set<string>();
    for (const entry of rows) {
      const row = sanitizeRow(spec, kind, entry);
      if (!row || keys.has(row.key)) return null;
      keys.add(row.key);
      parsed.push(row);
    }
    if (spec.single && parsed.length > 1) return null;
    state[spec.key] = parsed;
  }
  return state;
};

/** 画面から送る本文を作る（表示用の情報を落とす） */
export const toApplyPayload = (state: ReviewState): { rows: Record<string, unknown[]> } => ({
  rows: Object.fromEntries(
    Object.entries(state).map(([group, rows]) => [
      group,
      (rows ?? []).map((row) => ({ key: row.key, include: row.include, values: row.values, refs: row.refs, ...(row.ticked ? { ticked: row.ticked } : {}) })),
    ]),
  ),
});

export interface ApplyStep {
  group: GroupKey;
  row: ReviewRow;
  action: 'create' | 'transfer' | 'company';
  /** この手順より先に作られている必要がある行のキー */
  dependsOn: string[];
}

export type ApplyPlan = { ok: true; steps: ApplyStep[] } | { ok: false; error: string };

/** 対象の行を、参照される側が先になる順に並べる */
export const planApply = (kind: ImportDocumentKind, state: ReviewState): ApplyPlan => {
  const inKind = new Set(groupsOfKind(kind).map((spec) => spec.key));
  const steps: ApplyStep[] = [];
  const planned = new Set<string>();

  for (const group of APPLY_ORDER) {
    if (!inKind.has(group)) continue;
    const spec = GROUP_SPECS[group];
    if (spec.target.type === 'crosscheck') continue;
    for (const row of state[group] ?? []) {
      if (!row.include) continue;
      const dependsOn: string[] = [];
      for (const ref of spec.refs) {
        const parsed = parseRef(row.refs[ref.key]);
        if (parsed?.mode !== 'new') continue;
        if (!planned.has(parsed.key)) {
          return { ok: false, error: `${spec.label}の${ref.label}が、反映の対象になっていない行を指しています。選び直してください` };
        }
        dependsOn.push(parsed.key);
      }
      steps.push({ group, row, action: spec.target.type === 'resource' ? 'create' : spec.target.type, dependsOn });
      planned.add(row.key);
    }
  }
  if (steps.length === 0) return { ok: false, error: '反映する行がありません。対象にする行を選んでください' };
  return { ok: true, steps };
};
