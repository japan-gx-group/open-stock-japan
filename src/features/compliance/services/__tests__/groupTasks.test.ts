import { describe, expect, it } from 'vitest';
import type { ComplianceTask } from '@/lib/legal/calendar';
import { daysLeftLabel, groupTasks, openCountByCategory } from '../groupTasks';

const task = (overrides: Partial<ComplianceTask>): ComplianceTask => ({
  key: 'k',
  tracking: 'ledger',
  completedOn: null,
  completionNote: '',
  category: 'meeting',
  title: 't',
  dueOn: '2026-12-01',
  status: 'upcoming',
  daysLeft: 40,
  description: '',
  basis: '',
  href: null,
  ...overrides,
});

const tasks = [
  task({ key: 'a', status: 'overdue', daysLeft: -5, category: 'registration' }),
  task({ key: 'b', status: 'soon', daysLeft: 0 }),
  task({ key: 'c', status: 'upcoming', daysLeft: 40, category: 'tax' }),
  task({ key: 'd', status: 'done', dueOn: '2026-06-01', daysLeft: -100 }),
  task({ key: 'e', status: 'done', dueOn: '2026-09-01', daysLeft: -50 }),
];

describe('groupTasks', () => {
  it('期限超過・30日以内・今後・完了の順にまとめる', () => {
    const groups = groupTasks(tasks, 'all');
    expect(groups.map((group) => [group.label, group.tasks.map((row) => row.key)])).toEqual([
      ['期限超過', ['a']],
      ['30日以内', ['b']],
      ['今後', ['c']],
      ['完了', ['e', 'd']],
    ]);
  });

  it('区分で絞り込む', () => {
    const groups = groupTasks(tasks, 'meeting');
    expect(groups.flatMap((group) => group.tasks.map((row) => row.key))).toEqual(['b', 'e', 'd']);
  });
});

describe('openCountByCategory', () => {
  it('完了を除いて数える', () => {
    expect(openCountByCategory(tasks)).toMatchObject({ all: 3, meeting: 1, registration: 1, tax: 1, officer: 0 });
  });
});

describe('daysLeftLabel', () => {
  it('残り日数を文にする', () => {
    expect(daysLeftLabel({ status: 'overdue', daysLeft: -5 })).toBe('5 日超過');
    expect(daysLeftLabel({ status: 'soon', daysLeft: 0 })).toBe('今日が期限');
    expect(daysLeftLabel({ status: 'upcoming', daysLeft: 40 })).toBe('あと 40 日');
    expect(daysLeftLabel({ status: 'done', daysLeft: -100 })).toBe('完了');
  });
});
