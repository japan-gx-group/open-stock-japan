// 確認画面の状態の書き換え（純関数。元の状態は変えず、新しい状態を返す）。

import { GROUP_SPECS } from '@/lib/import/groups';
import { refExisting, refNew } from '@/lib/import/review';
import type { GroupKey, NamedRow, ReviewRow, ReviewState } from '@/lib/import/types';

const mapRow = (state: ReviewState, group: GroupKey, key: string, update: (row: ReviewRow) => ReviewRow): ReviewState => ({
  ...state,
  [group]: (state[group] ?? []).map((row) => (row.key === key ? update(row) : row)),
});

export const setRowValue = (state: ReviewState, group: GroupKey, key: string, field: string, value: string | boolean): ReviewState =>
  mapRow(state, group, key, (row) => ({ ...row, values: { ...row.values, [field]: value } }));

export const setRowRef = (state: ReviewState, group: GroupKey, key: string, ref: string, value: string): ReviewState =>
  mapRow(state, group, key, (row) => ({ ...row, refs: { ...row.refs, [ref]: value } }));

/** すべての行の参照のうち from を to に付け替える */
const repointRefs = (state: ReviewState, from: string, to: string): ReviewState =>
  Object.fromEntries(
    Object.entries(state).map(([group, rows]) => [
      group,
      (rows ?? []).map((row) =>
        Object.values(row.refs).includes(from)
          ? { ...row, refs: Object.fromEntries(Object.entries(row.refs).map(([ref, value]) => [ref, value === from ? to : value])) }
          : row,
      ),
    ]),
  ) as ReviewState;

/**
 * 行を対象にする・外す。登録済みの行と一致している行を外したときは、その行を「新しく作る」前提で
 * 参照していた行を、登録済みの行への参照に付け替える（対象に戻したときは、付け替えを元に戻す）。
 */
export const setRowIncluded = (state: ReviewState, group: GroupKey, key: string, include: boolean): ReviewState => {
  const row = state[group]?.find((item) => item.key === key);
  if (!row || row.include === include) return state;
  let next = mapRow(state, group, key, (item) => ({ ...item, include }));
  if (row.existing) {
    next = include ? repointRefs(next, refExisting(row.existing.id), refNew(key)) : repointRefs(next, refNew(key), refExisting(row.existing.id));
  }
  return next;
};

export const setGroupIncluded = (state: ReviewState, group: GroupKey, include: boolean): ReviewState =>
  (state[group] ?? []).reduce((current, row) => setRowIncluded(current, group, row.key, include), state);

/** 似た名前の登録済みの行と「同じ」とする: この行は作らず、参照を登録済みの行に付け替える */
export const linkToExistingRow = (state: ReviewState, group: GroupKey, key: string, existing: NamedRow): ReviewState => {
  const marked = mapRow(state, group, key, (row) => ({ ...row, include: false, existing, similar: row.similar.filter((item) => item.id !== existing.id) }));
  return repointRefs(marked, refNew(key), refExisting(existing.id));
};

/** 会社情報: 反映する項目を選ぶ・外す（1 つも無ければ会社情報を対象から外す） */
export const setCompanyFieldTicked = (state: ReviewState, key: string, field: string, ticked: boolean): ReviewState =>
  mapRow(state, 'company', key, (row) => {
    const current = (row.ticked ?? []).filter((item) => item !== field);
    const next = ticked ? [...current, field] : current;
    return { ...row, ticked: next, include: next.length > 0 };
  });

/** 対象の行すべてに同じ値を入れる（株主名簿の異動日など） */
export const setGroupValue = (state: ReviewState, group: GroupKey, field: string, value: string): ReviewState => ({
  ...state,
  [group]: (state[group] ?? []).map((row) => ({ ...row, values: { ...row.values, [field]: value } })),
});

/** 反映の確認に出す要約（まとまりごとの件数） */
export const summarizeApply = (state: ReviewState): string[] => {
  const lines: string[] = [];
  for (const [group, rows] of Object.entries(state) as [GroupKey, ReviewRow[]][]) {
    const spec = GROUP_SPECS[group];
    const included = (rows ?? []).filter((row) => row.include);
    if (included.length === 0 || spec.target.type === 'crosscheck') continue;
    if (spec.target.type === 'company') lines.push(`会社情報: ${included[0].ticked?.length ?? 0} 項目を更新`);
    else if (spec.target.type === 'transfer') lines.push(`株式譲渡: ${included.length} 件を記録（譲渡人の減少と譲受人の増加の 2 行ずつ）`);
    else lines.push(`${spec.label}: ${included.length} 件を新しく登録`);
  }
  return lines;
};
