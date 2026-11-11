'use client';

// 手続きカレンダー: 期限のある手続き（招集通知・議事録・登記・申告・任期満了など）を状態ごとに並べる。
// 一覧は useComplianceTasks（計算は src/lib/legal/calendar.ts）から取り、この画面は絞り込みと表示だけを行う。

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Loader2, Undo2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { EmptyState, ErrorBlock, LoadingBlock, StatGrid, StatTile } from '@/components/resource/parts';
import { Badge } from '@/components/ui/badge';
import { useComplianceTasks } from '@/hooks/useComplianceTasks';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { formatDateJa, todayInTokyo } from '@/lib/equity/format';
import { errorMessage } from '@/lib/resources/client';
import { canEdit } from '@/types/role';
import type { ComplianceTask, TaskStatus } from '@/lib/legal/calendar';
import {
  daysLeftLabel,
  groupTasks,
  openCountByCategory,
  TASK_CATEGORY_LABELS,
  type CategoryFilter,
} from '../services/groupTasks';

const STATUS_VARIANT: Record<TaskStatus, 'danger' | 'warning' | 'neutral' | 'success'> = {
  overdue: 'danger',
  soon: 'warning',
  upcoming: 'neutral',
  done: 'success',
};

const CATEGORY_FILTERS: CategoryFilter[] = ['all', 'meeting', 'registration', 'tax', 'disclosure', 'officer', 'equity'];

type SetCompletion = (taskKey: string, completedOn: string | null, note?: string) => Promise<void>;

// 台帳に対応する日付の項目が無い手続き（tracking = manual）を、この一覧で完了にする・取り消す。
const CompletionControl = ({ task, setCompletion }: { task: ComplianceTask; setCompletion: SetCompletion }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [completedOn, setCompletedOn] = useState(todayInTokyo);
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (date: string | null) => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await setCompletion(task.key, date, note);
      setIsOpen(false);
    } catch (caught) {
      setError(errorMessage(caught, '記録に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  if (task.status === 'done') {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" className="gt-btn h-8 px-2 text-[12px]" disabled={isSaving} onClick={() => void run(null)}>
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
          完了を取り消す
        </button>
        {error && <span role="alert" className="text-[12px] text-danger">{error}</span>}
      </div>
    );
  }
  if (!isOpen) {
    return (
      <button type="button" className="gt-btn h-8 px-2 text-[12px]" onClick={() => setIsOpen(true)}>
        <Check size={14} />
        完了にする
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 w-full sm:w-[260px]">
      <label className="gt-field-label m-0" htmlFor={`done-on-${task.key}`}>
        完了した日
      </label>
      <input
        id={`done-on-${task.key}`}
        type="date"
        className="gt-field"
        value={completedOn}
        max={todayInTokyo()}
        onChange={(event) => setCompletedOn(event.target.value)}
      />
      <input
        className="gt-field"
        aria-label="メモ"
        placeholder="メモ（任意）例: e-Tax で申告済み"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
      />
      {error && <span role="alert" className="text-[12px] text-danger">{error}</span>}
      <div className="flex justify-end gap-2">
        <button type="button" className="gt-btn h-8 px-2 text-[12px]" disabled={isSaving} onClick={() => setIsOpen(false)}>
          キャンセル
        </button>
        <button type="button" className="gt-btn gt-btn-primary h-8 px-2 text-[12px]" disabled={isSaving || !completedOn} onClick={() => void run(completedOn)}>
          {isSaving && <Loader2 size={14} className="animate-spin" />}
          記録する
        </button>
      </div>
    </div>
  );
};

const TaskRow = ({ task, setCompletion }: { task: ComplianceTask; setCompletion: SetCompletion | null }) => (
  <li className="flex items-start gap-4 border-b border-border py-3 last:border-b-0 flex-wrap sm:flex-nowrap">
    <div className="w-[132px] shrink-0">
      <div className="text-[13.5px] font-semibold text-text-heading tabular-nums whitespace-nowrap">{formatDateJa(task.dueOn)}</div>
      <div className="mt-1">
        <Badge variant={STATUS_VARIANT[task.status]}>{daysLeftLabel(task)}</Badge>
      </div>
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[14px] font-semibold text-text-heading">{task.title}</span>
        <Badge variant="outline">{TASK_CATEGORY_LABELS[task.category]}</Badge>
      </div>
      <p className="text-[13px] leading-relaxed text-text-body mt-1 mb-0">{task.description}</p>
      <p className="text-[12px] text-text-muted mt-1 mb-0">根拠: {task.basis}</p>
      {task.completedOn && (
        <p className="text-[12px] text-text-muted mt-1 mb-0">
          {formatDateJa(task.completedOn)} に完了として記録{task.completionNote ? `（${task.completionNote}）` : ''}
        </p>
      )}
      {task.tracking === 'ledger' && task.status !== 'done' && (
        <p className="text-[12px] text-text-muted mt-1 mb-0">関連する画面で日付を記録すると完了になります。</p>
      )}
    </div>
    <div className="flex flex-col items-end gap-2 shrink-0">
      {task.href && (
        <Link href={task.href} className="gt-btn h-8 px-2 text-[12px]">
          関連する画面
          <ArrowRight size={14} />
        </Link>
      )}
      {setCompletion && task.tracking === 'manual' && <CompletionControl task={task} setCompletion={setCompletion} />}
    </div>
  </li>
);

export const ComplianceCalendar = () => {
  const { tasks, isLoading, error, reload, setCompletion } = useComplianceTasks();
  const { role } = useCurrentUser();
  const isEditor = canEdit(role);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const groups = useMemo(() => groupTasks(tasks, category), [tasks, category]);
  const counts = useMemo(() => openCountByCategory(tasks), [tasks]);
  const all = useMemo(() => groupTasks(tasks, 'all'), [tasks]);
  const visibleCount = groups.reduce((total, group) => total + group.tasks.length, 0);

  return (
    <div className="page-body">
      <PageHeading title="手続きカレンダー" description="期限のある手続きを、台帳と会議の記録から洗い出して並べます" />

      <div className="flex flex-col gap-4 max-w-[1040px]">
        <section className="gt-card" aria-label="この一覧について">
          <div className="gt-card-title">この一覧について</div>
          <ul className="m-0 mt-2 pl-5 list-disc text-[13px] leading-relaxed text-text-body flex flex-col gap-1">
            <li>
              登録済みの事業年度・会議・役員・資金調達ラウンド・新株予約権・転換型証券と、会社情報の機関設計・定款の定めから、期限を計算して並べています（過去 180 日から先 400 日まで）。
            </li>
            <li>
              「完了」は台帳の記録から判定します。招集通知は発送日、議事録は確定日、登記は登記日、定時株主総会は進行状況を、それぞれの画面で記録すると完了になります。
            </li>
            <li>
法人税等の申告、特定新株予約権の付与に関する調書、決算公告、新株予約権の行使による登記、役員の任期満了など、台帳に完了した日の項目が無い手続きは、この一覧の「完了にする」で完了した日を記録します（記録は監査ログに残ります）。記録しないまま期限を過ぎると「期限超過」に表示され、180 日を過ぎると一覧から外れます。
            </li>
            <li>期限は実務の目安です。定款・契約の定めや申告期限の延長の特例などは反映していないものがあります。個別の判断は専門家に確認してください。</li>
          </ul>
        </section>

        {isLoading && tasks.length === 0 ? (
          <LoadingBlock />
        ) : error && tasks.length === 0 ? (
          <ErrorBlock message={error} onRetry={() => void reload()} />
        ) : (
          <>
            {error && <ErrorBlock message={error} onRetry={() => void reload()} />}
            <StatGrid>
              {all.map((group) => (
                <StatTile key={group.status} label={group.label} value={`${group.tasks.length} 件`} />
              ))}
            </StatGrid>

            <div className="flex flex-wrap gap-2" role="group" aria-label="区分で絞り込む">
              {CATEGORY_FILTERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={category === value}
                  className={`gt-pill ${category === value ? 'gt-pill-accent' : 'gt-pill-neutral'} cursor-pointer border-none`}
                  onClick={() => setCategory(value)}
                >
                  {value === 'all' ? 'すべて' : TASK_CATEGORY_LABELS[value]}
                  <span className="ml-1 tabular-nums">{counts[value]}</span>
                </button>
              ))}
            </div>

            {visibleCount === 0 ? (
              <EmptyState
                title="該当する手続きはありません"
                description="事業年度・会議・役員・資金調達ラウンド・新株予約権を登録すると、期限のある手続きがここに並びます。"
              />
            ) : (
              groups
                .filter((group) => group.tasks.length > 0)
                .map((group) => (
                  <section key={group.status} className="gt-card" aria-labelledby={`tasks-${group.status}`}>
                    <div className="flex items-center gap-2">
                      <h2 id={`tasks-${group.status}`} className="gt-card-title m-0">
                        {group.label}
                      </h2>
                      <Badge variant={STATUS_VARIANT[group.status]}>{group.tasks.length} 件</Badge>
                    </div>
                    <div className="gt-card-sub">{group.description}</div>
                    <ul className="list-none p-0 m-0 mt-2">
                      {group.tasks.map((task) => (
                        <TaskRow key={task.key} task={task} setCompletion={isEditor ? setCompletion : null} />
                      ))}
                    </ul>
                  </section>
                ))
            )}
          </>
        )}
      </div>
    </div>
  );
};
