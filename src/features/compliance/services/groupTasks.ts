// 手続きカレンダーの表示用の絞り込み・グループ分け。サーバ依存なし。計算そのものは src/lib/legal/calendar.ts。

import type { ComplianceTask, TaskCategory, TaskStatus } from '@/lib/legal/calendar';

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  meeting: '株主総会・取締役会',
  registration: '登記',
  tax: '税務',
  disclosure: '決算・開示',
  officer: '役員',
  equity: '株式・新株予約権',
};

export const TASK_STATUS_GROUPS: readonly { status: TaskStatus; label: string; description: string }[] = [
  { status: 'overdue', label: '期限超過', description: '期限を過ぎていて、完了の記録がありません。' },
  { status: 'soon', label: '30日以内', description: '期限まで 30 日以内です。' },
  { status: 'upcoming', label: '今後', description: '期限まで 31 日以上あります。' },
  { status: 'done', label: '完了', description: '台帳・会議の記録から済んでいると判定したものと、この一覧で完了を記録したものです。' },
];

export type CategoryFilter = TaskCategory | 'all';

export interface TaskGroup {
  status: TaskStatus;
  label: string;
  description: string;
  tasks: ComplianceTask[];
}

/** 区分で絞り込み、状態ごとにまとめる（並びは buildComplianceCalendar の順のまま。完了だけ新しい順） */
export const groupTasks = (tasks: ComplianceTask[], category: CategoryFilter): TaskGroup[] => {
  const filtered = category === 'all' ? tasks : tasks.filter((task) => task.category === category);
  return TASK_STATUS_GROUPS.map((group) => {
    const rows = filtered.filter((task) => task.status === group.status);
    return { ...group, tasks: group.status === 'done' ? [...rows].sort((a, b) => b.dueOn.localeCompare(a.dueOn)) : rows };
  });
};

/** 区分ごとの件数（完了を除く）。絞り込みのボタンに出す */
export const openCountByCategory = (tasks: ComplianceTask[]): Record<CategoryFilter, number> => {
  const counts: Record<CategoryFilter, number> = { all: 0, meeting: 0, registration: 0, tax: 0, disclosure: 0, officer: 0, equity: 0 };
  for (const task of tasks) {
    if (task.status === 'done') continue;
    counts.all += 1;
    counts[task.category] += 1;
  }
  return counts;
};

/** 「あと 12 日」「今日が期限」「5 日超過」 */
export const daysLeftLabel = (task: Pick<ComplianceTask, 'daysLeft' | 'status'>): string => {
  if (task.status === 'done') return '完了';
  if (task.daysLeft < 0) return `${-task.daysLeft} 日超過`;
  if (task.daysLeft === 0) return '今日が期限';
  return `あと ${task.daysLeft} 日`;
};
