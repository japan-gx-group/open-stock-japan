'use client';

// 手続きカレンダー（期限のある手続きの一覧）を、台帳・会議・役員・事業年度から組み立てる。
// ダッシュボードと「手続きカレンダー」の画面で使う。計算は src/lib/legal/calendar.ts。

import { useCallback, useMemo } from 'react';
import { todayInTokyo } from '@/lib/equity/format';
import {
  buildComplianceCalendar,
  type CalendarFiscalYear,
  type CalendarMeeting,
  type CalendarOfficer,
  type ComplianceTask,
  type TaskCompletions,
} from '@/lib/legal/calendar';
import { apiFetch, fetchCompany, fetchSnapshot, listItems } from '@/lib/resources/client';
import { governanceOf } from '@/lib/resources/company';
import { useAsyncData } from './useAsyncData';

export const useComplianceTasks = (): {
  tasks: ComplianceTask[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** 完了を記録する（completedOn に null を渡すと取り消し）。失敗したら例外を投げる */
  setCompletion: (taskKey: string, completedOn: string | null, note?: string) => Promise<void>;
} => {
  const load = useCallback(
    async () => {
      const [company, snapshot, fiscalYears, meetings, officers, states] = await Promise.all([
        fetchCompany(),
        fetchSnapshot(),
        listItems('fiscal-years'),
        listItems('meetings'),
        listItems('officers'),
        apiFetch<{ completions: TaskCompletions }>('/api/compliance/states'),
      ]);
      return { company, snapshot, fiscalYears, meetings, officers, completions: states.completions };
    },
    [],
  );
  const { data, isLoading, error, reload } = useAsyncData(load);

  const tasks = useMemo(() => {
    if (!data) return [];
    const startMonth = Number(data.company.fiscalYearStartMonth);
    return buildComplianceCalendar({
      today: todayInTokyo(),
      governance: governanceOf(data.company),
      fiscalYearStartMonth: Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? startMonth : null,
      fiscalYears: data.fiscalYears as unknown as CalendarFiscalYear[],
      meetings: data.meetings as unknown as CalendarMeeting[],
      officers: data.officers as unknown as CalendarOfficer[],
      snapshot: data.snapshot,
      completions: data.completions,
    });
  }, [data]);

  const setCompletion = useCallback(
    async (taskKey: string, completedOn: string | null, note = '') => {
      await apiFetch('/api/compliance/states', { method: 'PUT', body: JSON.stringify({ taskKey, completedOn, note }) });
      await reload();
    },
    [reload],
  );

  return { tasks, isLoading, error, reload, setCompletion };
};
