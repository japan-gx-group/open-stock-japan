import { describe, expect, it } from 'vitest';
import { buildCapTable } from '@/lib/equity/capTable';
import type { ComplianceTask } from '@/lib/legal/calendar';
import { sampleSnapshot } from '@/lib/equity/__tests__/fixture';
import { countByStatus, ownershipSlices, upcomingTasks } from '../overview';

describe('ownershipSlices', () => {
  const table = buildCapTable(sampleSnapshot());

  it('上位と「その他」と未割当枠に分け、比率の合計は 1 になる', () => {
    const slices = ownershipSlices(table, 2);
    expect(slices.map((slice) => slice.kind)).toEqual(['holder', 'holder', 'other', 'pool']);
    expect(slices[0].name).toBe('山田 太郎');
    expect(slices[2].name).toBe('その他（3名）');
    expect(slices.reduce((total, slice) => total + slice.ratio, 0)).toBeCloseTo(1, 9);
    expect(slices.reduce((total, slice) => total + slice.shares, 0)).toBe(table.totals.fullyDilutedShares);
  });

  it('上位に収まるときは「その他」を作らない', () => {
    expect(ownershipSlices(table, 8).some((slice) => slice.kind === 'other')).toBe(false);
  });
});

const task = (key: string, dueOn: string, status: ComplianceTask['status']): ComplianceTask => ({
  key,
  category: 'registration',
  tracking: 'ledger',
  completedOn: null,
  completionNote: '',
  title: key,
  dueOn,
  status,
  daysLeft: 0,
  description: '',
  basis: '',
  href: null,
});

describe('upcomingTasks / countByStatus', () => {
  const tasks = [task('c', '2026-12-01', 'upcoming'), task('a', '2026-10-01', 'overdue'), task('done', '2026-09-01', 'done'), task('b', '2026-11-15', 'soon')];

  it('済んだものを除き、期限の近い順に並べる', () => {
    expect(upcomingTasks(tasks, 2).map((item) => item.key)).toEqual(['a', 'b']);
    expect(upcomingTasks(tasks).map((item) => item.key)).toEqual(['a', 'b', 'c']);
  });

  it('期限超過と期限間近を数える', () => {
    expect(countByStatus(tasks)).toEqual({ overdue: 1, soon: 1 });
  });
});
