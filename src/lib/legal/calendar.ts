// 手続きカレンダー: 台帳と会議の記録から、期限のある手続き（招集通知・登記・申告・調書・任期満了など）を洗い出す。
// サーバ依存なし。期限の数え方は rules.ts、根拠は docs/legal/。

import { addDays, addMonths, diffDays } from '@/lib/equity/format';
import type { EquitySnapshot } from '@/lib/equity/types';
import {
  annualMeetingDeadline,
  boardMeetingNoticeRule,
  corporateTaxReturnDeadline,
  financialStatementsDisplayStart,
  LEGAL,
  noticeDeadline,
  officerTermEnd,
  officerTermYears,
  optionExerciseRegistrationDeadline,
  registrationDeadline,
  shareholderMeetingNoticeRule,
  type Governance,
} from './rules';

export type TaskCategory = 'meeting' | 'registration' | 'tax' | 'disclosure' | 'officer' | 'equity';
export type TaskStatus = 'overdue' | 'soon' | 'upcoming' | 'done';

export interface ComplianceTask {
  key: string;
  category: TaskCategory;
  title: string;
  dueOn: string;
  status: TaskStatus;
  /** 今日から期限までの日数（過ぎていれば負） */
  daysLeft: number;
  description: string;
  basis: string;
  /** 関連する画面 */
  href: string | null;
  /**
   * 完了の判定のしかた。
   *   ledger = 台帳の日付（発送日・確定日・登記日など）から判定する。関連する画面で日付を記録すると完了になる
   *   manual = 台帳に対応する項目が無いので、この一覧で人が完了を記録する
   */
  tracking: 'ledger' | 'manual';
  /** 人が記録した完了日（manual で完了にしたときだけ） */
  completedOn: string | null;
  completionNote: string;
}

/** 人が記録した完了（compliance_task_states）。キーは ComplianceTask.key */
export type TaskCompletions = Record<string, { completedOn: string; note: string }>;

export interface CalendarFiscalYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface CalendarMeeting {
  id: string;
  meetingType: 'agm' | 'egm' | 'class_meeting' | 'board';
  title: string;
  format: string;
  status: string;
  fiscalYearId: string | null;
  heldOn: string | null;
  noticeSentOn: string | null;
  minutesFinalizedOn: string | null;
}

export interface CalendarOfficer {
  id: string;
  name: string;
  position: string;
  appointedOn: string | null;
  termExpiresOn: string | null;
  retiredOn: string | null;
  registeredOn: string | null;
}

export interface CalendarInput {
  today: string;
  governance: Governance;
  fiscalYearStartMonth: number | null;
  fiscalYears: CalendarFiscalYear[];
  meetings: CalendarMeeting[];
  officers: CalendarOfficer[];
  snapshot: EquitySnapshot;
  /** 人が記録した完了 */
  completions?: TaskCompletions;
  /** 何日先までの予定を出すか（既定 400 日） */
  horizonDays?: number;
  /** 何日前までの期限切れを出すか（既定 180 日） */
  lookbackDays?: number;
}

/** 「期限が近い」とする日数 */
export const CALENDAR_SOON_DAYS = 30;
/** 既定で何日先までの予定を出すか */
export const CALENDAR_HORIZON_DAYS = 400;
/** 既定で何日前までの期限を出すか */
export const CALENDAR_LOOKBACK_DAYS = 180;

export const buildComplianceCalendar = (input: CalendarInput): ComplianceTask[] => {
  const { today, governance, snapshot } = input;
  const horizon = addDays(today, input.horizonDays ?? CALENDAR_HORIZON_DAYS);
  const lookback = addDays(today, -(input.lookbackDays ?? CALENDAR_LOOKBACK_DAYS));
  const tasks: ComplianceTask[] = [];

  // done を渡した手続きは台帳の記録から完了を判定する（ledger）。渡さない手続きは人が完了を記録する（manual）。
  const push = (
    task: Omit<ComplianceTask, 'status' | 'daysLeft' | 'tracking' | 'completedOn' | 'completionNote'> & { done?: boolean },
  ): void => {
    const { done, ...rest } = task;
    if (rest.dueOn > horizon || rest.dueOn < lookback) return;
    const tracking = done === undefined ? 'manual' : 'ledger';
    const completion = tracking === 'manual' ? (input.completions?.[rest.key] ?? null) : null;
    const daysLeft = diffDays(today, rest.dueOn);
    const status: TaskStatus =
      done || completion ? 'done' : daysLeft < 0 ? 'overdue' : daysLeft <= CALENDAR_SOON_DAYS ? 'soon' : 'upcoming';
    tasks.push({
      ...rest,
      status,
      daysLeft,
      tracking,
      completedOn: completion?.completedOn ?? null,
      completionNote: completion?.note ?? '',
    });
  };

  const shareholderMeetings = input.meetings.filter((meeting) => meeting.meetingType !== 'board');
  const boardMeetings = input.meetings.filter((meeting) => meeting.meetingType === 'board');

  // 1) 事業年度ごと: 定時株主総会・法人税の申告・計算書類の備置き・決算公告
  for (const fiscalYear of input.fiscalYears) {
    const agm = shareholderMeetings.find(
      (meeting) => meeting.meetingType === 'agm' && meeting.fiscalYearId === fiscalYear.id,
    );
    const agmHeld = agm != null && (agm.status === 'held' || agm.status === 'closed');
    push({
      key: `agm:${fiscalYear.id}`,
      category: 'meeting',
      title: `${fiscalYear.label} 定時株主総会の開催`,
      dueOn: agm?.heldOn ?? annualMeetingDeadline(fiscalYear.endDate),
      done: agmHeld,
      description: agm?.heldOn
        ? `${agm.title} を予定しています。`
        : '事業年度の終了後、一定の時期に招集します。基準日を事業年度末日とする場合、基準日から 3 か月以内に開催する必要があります。',
      basis: '会社法296条1項・124条2項',
      href: agm ? `/shareholder-meetings/${agm.id}` : '/shareholder-meetings',
    });
    push({
      key: `tax:${fiscalYear.id}`,
      category: 'tax',
      title: `${fiscalYear.label} 法人税・消費税の確定申告`,
      dueOn: corporateTaxReturnDeadline(fiscalYear.endDate),
      description: '事業年度終了の日の翌日から 2 か月以内（申告期限の延長の特例を受けている場合はその期限）。',
      basis: '法人税法74条1項',
      href: '/financials',
    });
    if (agm?.heldOn) {
      push({
        key: `fs-display:${fiscalYear.id}`,
        category: 'disclosure',
        title: `${fiscalYear.label} 計算書類・事業報告の備置き開始`,
        dueOn: financialStatementsDisplayStart(agm.heldOn, governance),
        done: agmHeld,
        description: `定時株主総会の日の${governance.hasBoardOfDirectors ? ' 2 週間' : ' 1 週間'}前から 5 年間、本店に備え置きます。`,
        basis: '会社法442条1項',
        href: '/financials',
      });
      push({
        key: `public-notice:${fiscalYear.id}`,
        category: 'disclosure',
        title: `${fiscalYear.label} 決算公告`,
        dueOn: addDays(agm.heldOn, 1),
        description: '定時株主総会の終結後、遅滞なく貸借対照表（大会社は損益計算書も）を公告します。',
        basis: '会社法440条1項',
        href: '/financials',
      });
    }
  }

  // 2) 会議ごと: 招集通知の発送期限・議事録の作成
  for (const meeting of input.meetings) {
    if (!meeting.heldOn) continue;
    const isBoard = meeting.meetingType === 'board';
    const href = `${isBoard ? '/board-meetings' : '/shareholder-meetings'}/${meeting.id}`;
    if (meeting.format !== 'written_resolution') {
      const rule = isBoard ? boardMeetingNoticeRule(governance) : shareholderMeetingNoticeRule(governance);
      push({
        key: `notice:${meeting.id}`,
        category: 'meeting',
        title: `${meeting.title} 招集通知の発送`,
        dueOn: noticeDeadline(meeting.heldOn, rule.days),
        done: meeting.noticeSentOn != null || meeting.status === 'held' || meeting.status === 'closed',
        description: `会日の ${rule.days} 日前までに発送します${rule.note ? `（${rule.note}）` : ''}。${
          isBoard ? '取締役・監査役の全員の同意があれば招集手続を省略できます（368条2項）。' : '株主全員の同意があれば招集手続を省略できます（300条）。'
        }`,
        basis: rule.basis,
        href,
      });
    }
    if (meeting.heldOn <= today) {
      push({
        key: `minutes:${meeting.id}`,
        category: 'meeting',
        title: `${meeting.title} 議事録の作成・備置き`,
        dueOn: meeting.heldOn,
        done: meeting.minutesFinalizedOn != null,
        description: `議事録を作成し、会日から ${LEGAL.minutesRetentionYears} 年間、本店に備え置きます。`,
        basis: isBoard ? '会社法369条3項・371条1項' : '会社法318条',
        href,
      });
    }
  }

  // 3) 取締役会: 3 か月に 1 回以上の職務執行状況の報告
  if (governance.hasBoardOfDirectors) {
    const held = boardMeetings
      .filter((meeting) => meeting.heldOn != null && meeting.heldOn <= today && meeting.format !== 'written_resolution')
      .map((meeting) => meeting.heldOn as string)
      .sort();
    const last = held.at(-1);
    const scheduled = boardMeetings.some((meeting) => meeting.heldOn != null && meeting.heldOn > today);
    if (last) {
      push({
        key: 'board-report',
        category: 'meeting',
        title: '取締役会の開催（職務執行状況の報告）',
        dueOn: addMonths(last, LEGAL.boardReportIntervalMonths),
        done: false,
        description: `代表取締役・業務執行取締役は 3 か月に 1 回以上、職務の執行の状況を取締役会に報告します。この報告は書面決議・報告の省略ができないため、実際に開催する必要があります（前回: ${last}${
          scheduled ? '。次回の予定が登録されています' : ''
        }）。`,
        basis: '会社法363条2項・372条2項',
        href: '/board-meetings',
      });
    }
  }

  // 4) 役員の任期満了
  for (const officer of input.officers) {
    if (officer.retiredOn) continue;
    let dueOn = officer.termExpiresOn;
    if (!dueOn && officer.appointedOn && input.fiscalYearStartMonth) {
      const years = officerTermYears(officer.position, governance);
      if (years != null) dueOn = officerTermEnd(officer.appointedOn, years, input.fiscalYearStartMonth).meetingDeadline;
    }
    if (!dueOn) continue;
    push({
      key: `officer-term:${officer.id}`,
      category: 'officer',
      title: `${officer.name} の任期満了（再任・退任の決議と登記）`,
      dueOn,
      description:
        '任期満了の定時株主総会で再任（重任）または後任の選任を決議し、2 週間以内に変更の登記をします。同じ人が続ける場合も重任の登記が必要です。',
      basis: '会社法332条・336条・915条1項',
      href: '/company',
    });
  }

  // 5) 登記: 募集株式の発行（クローズした資金調達ラウンド）
  for (const round of snapshot.fundingRounds) {
    if (round.status !== 'closed' || !round.closingDate || round.roundType === 'founding') continue;
    push({
      key: `round-registration:${round.id}`,
      category: 'registration',
      title: `${round.name} 募集株式の発行の登記`,
      dueOn: registrationDeadline(round.closingDate),
      done: round.registrationDate != null,
      description: '払込期日（または払込期間の末日）から 2 週間以内に、発行済株式の総数・資本金の額の変更を登記します。',
      basis: '会社法915条1項・2項',
      href: '/rounds',
    });
  }

  // 6) 新株予約権: 発行の登記・行使による登記・付与調書・行使期間の終了
  const planById = new Map(snapshot.optionPlans.map((plan) => [plan.id, plan]));
  const grantById = new Map(snapshot.optionGrants.map((grant) => [grant.id, grant]));
  for (const plan of snapshot.optionPlans) {
    if (plan.allotmentDate) {
      push({
        key: `option-registration:${plan.id}`,
        category: 'registration',
        title: `${plan.name} 新株予約権の発行の登記`,
        dueOn: registrationDeadline(plan.allotmentDate),
        done: plan.registeredOn != null,
        description: '割当日から 2 週間以内に、新株予約権の数・目的となる株式・行使価額・行使期間・行使条件などを登記します。',
        basis: '会社法911条3項12号・915条1項',
        href: '/stock-options',
      });
      if (plan.planType === 'tax_qualified') {
        push({
          key: `option-report:${plan.id}`,
          category: 'tax',
          title: `${plan.name} 特定新株予約権の付与に関する調書の提出`,
          dueOn: `${Number(plan.allotmentDate.slice(0, 4)) + 1}-01-31`,
          description: '税制適格ストックオプションを付与した日の属する年の翌年 1 月 31 日までに、所轄の税務署へ提出します。',
          basis: '租税特別措置法29条の2第6項',
          href: '/stock-options',
        });
      }
    }
    if (plan.exercisePeriodEnd) {
      push({
        key: `option-expiry:${plan.id}`,
        category: 'equity',
        title: `${plan.name} 行使期間の満了`,
        dueOn: plan.exercisePeriodEnd,
        description: '行使期間が満了すると、未行使の新株予約権は消滅します（消滅の登記が必要です）。',
        basis: '会社法287条・915条1項',
        href: '/stock-options',
      });
    }
  }
  const exerciseMonths = new Set<string>();
  for (const event of snapshot.optionEvents) {
    if (event.eventType !== 'exercise') continue;
    const grant = grantById.get(event.grantId);
    if (!grant || !planById.has(grant.planId)) continue;
    exerciseMonths.add(event.eventDate.slice(0, 7));
  }
  for (const month of exerciseMonths) {
    push({
      key: `exercise-registration:${month}`,
      category: 'registration',
      title: `${month.replace('-', '年')}月の新株予約権の行使による変更の登記`,
      dueOn: optionExerciseRegistrationDeadline(`${month}-01`),
      description: '行使があった月の末日から 2 週間以内に、発行済株式の総数・資本金の額・新株予約権の数の変更をまとめて登記します。',
      basis: '会社法915条3項1号',
      href: '/stock-options',
    });
  }

  // 7) 転換型証券の転換期限
  for (const round of snapshot.convertibleRounds) {
    if (round.status !== 'outstanding' || !round.conversionDeadline) continue;
    push({
      key: `convertible-deadline:${round.id}`,
      category: 'equity',
      title: `${round.name} 転換期限`,
      dueOn: round.conversionDeadline,
      description:
        '転換期限までに適格資金調達が無い場合の扱い（普通株式への転換など）は契約書の定めによります。投資家との協議を早めに始めてください。',
      basis: '投資契約（J-KISS 等）',
      href: '/convertibles',
    });
  }

  const order: Record<TaskStatus, number> = { overdue: 0, soon: 1, upcoming: 2, done: 3 };
  return tasks.sort((a, b) => order[a.status] - order[b.status] || a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title, 'ja'));
};
