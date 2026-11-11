// ダッシュボードの表示用の組み立て（持株比率の上位と「その他」、近い期限の手続き）。

import type { CapTable } from '@/lib/equity/capTable';
import type { ComplianceTask } from '@/lib/legal/calendar';

export interface OwnershipSlice {
  key: string;
  name: string;
  /** 完全希釈化後の株式数 */
  shares: number;
  /** 完全希釈化後の比率 */
  ratio: number;
  kind: 'holder' | 'pool' | 'other';
}

export const OTHER_SLICE_KEY = 'other';

/** 完全希釈化後の比率の上位 topN 人と、残りをまとめた「その他」、未割当の枠 */
export const ownershipSlices = (table: CapTable, topN = 8): OwnershipSlice[] => {
  const holders = table.rows
    .filter((row) => row.kind !== 'pool' && row.fullyDilutedShares > 0)
    .sort((a, b) => b.fullyDilutedShares - a.fullyDilutedShares);
  const slices: OwnershipSlice[] = holders.slice(0, topN).map((row) => ({
    key: row.stakeholderId,
    name: row.name,
    shares: row.fullyDilutedShares,
    ratio: row.fullyDilutedRatio,
    kind: 'holder',
  }));
  const rest = holders.slice(topN);
  if (rest.length > 0) {
    slices.push({
      key: OTHER_SLICE_KEY,
      name: `その他（${rest.length}名）`,
      shares: rest.reduce((total, row) => total + row.fullyDilutedShares, 0),
      ratio: rest.reduce((total, row) => total + row.fullyDilutedRatio, 0),
      kind: 'other',
    });
  }
  const pool = table.rows.find((row) => row.kind === 'pool' && row.fullyDilutedShares > 0);
  if (pool) {
    slices.push({ key: pool.stakeholderId, name: pool.name, shares: pool.fullyDilutedShares, ratio: pool.fullyDilutedRatio, kind: 'pool' });
  }
  return slices;
};

/** まだ済んでいない手続きを、期限の近い順に limit 件 */
export const upcomingTasks = (tasks: readonly ComplianceTask[], limit = 6): ComplianceTask[] =>
  tasks
    .filter((task) => task.status !== 'done')
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title, 'ja'))
    .slice(0, limit);

export const countByStatus = (tasks: readonly ComplianceTask[]): { overdue: number; soon: number } => ({
  overdue: tasks.filter((task) => task.status === 'overdue').length,
  soon: tasks.filter((task) => task.status === 'soon').length,
});
