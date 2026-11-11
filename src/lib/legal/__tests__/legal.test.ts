import { describe, expect, it } from 'vitest';
import { optionEvent, optionGrant, optionPlan, sampleSnapshot } from '@/lib/equity/__tests__/fixture';
import { buildComplianceCalendar } from '../calendar';
import {
  boardMeetingNoticeRule,
  boardProcedureNotes,
  capitalIncreaseRegistrationTax,
  DEFAULT_GOVERNANCE,
  evaluateResolution,
  isRecordDateValid,
  minimumCapitalIncrease,
  noticeDeadline,
  officerTermEnd,
  officerTermYears,
  optionExerciseRegistrationDeadline,
  registrationDeadline,
  shareholderMeetingNoticeRule,
} from '../rules';
import { annualExerciseAmounts, annualExerciseLimit, checkGrantRequirements, checkPlanRequirements } from '../taxQualified';

describe('招集通知の期限', () => {
  it('非公開会社は 1 週間前、公開会社と書面投票を定めた場合は 2 週間前', () => {
    expect(shareholderMeetingNoticeRule(DEFAULT_GOVERNANCE).days).toBe(7);
    expect(shareholderMeetingNoticeRule({ ...DEFAULT_GOVERNANCE, isPublicCompany: true }).days).toBe(14);
    expect(shareholderMeetingNoticeRule(DEFAULT_GOVERNANCE, { writtenOrElectronicVoting: true }).days).toBe(14);
  });

  it('1 週間より短い定款の定めは取締役会を置かない会社だけ有効', () => {
    expect(shareholderMeetingNoticeRule({ ...DEFAULT_GOVERNANCE, shareholderMeetingNoticeDays: 3 }).days).toBe(7);
    expect(shareholderMeetingNoticeRule({ ...DEFAULT_GOVERNANCE, hasBoardOfDirectors: false, shareholderMeetingNoticeDays: 3 }).days).toBe(3);
  });

  it('発送日と会日の間に丸 n 日を空ける', () => {
    expect(noticeDeadline('2026-06-27', 14)).toBe('2026-06-12');
    expect(noticeDeadline('2026-06-27', 7)).toBe('2026-06-19');
  });

  it('取締役会は 1 週間前（定款で短縮できる）', () => {
    expect(boardMeetingNoticeRule(DEFAULT_GOVERNANCE).days).toBe(7);
    expect(boardMeetingNoticeRule({ ...DEFAULT_GOVERNANCE, boardMeetingNoticeDays: 3 }).days).toBe(3);
  });

  it('会計限定の監査役は招集通知の宛先・書面決議の異議に含めない', () => {
    expect(boardProcedureNotes(DEFAULT_GOVERNANCE).noticeTo).toBe('各取締役および各監査役');
    expect(boardProcedureNotes({ ...DEFAULT_GOVERNANCE, auditorLimitedToAccounting: true }).noticeTo).toBe('各取締役');
    expect(boardProcedureNotes(DEFAULT_GOVERNANCE).writtenResolution).toContain('定款');
  });
});

describe('期限・資本金', () => {
  it('基準日は権利行使の日の前 3 か月以内', () => {
    expect(isRecordDateValid('2026-03-31', '2026-06-30')).toBe(true);
    expect(isRecordDateValid('2026-03-31', '2026-07-01')).toBe(false);
  });

  it('登記は 2 週間以内、新株予約権の行使は月末から 2 週間以内', () => {
    expect(registrationDeadline('2026-06-27')).toBe('2026-07-11');
    expect(optionExerciseRegistrationDeadline('2026-06-03')).toBe('2026-07-14');
  });

  it('資本金は払込金額の 2 分の 1 以上、登録免許税は 0.7%（最低 3 万円）', () => {
    expect(minimumCapitalIncrease(100_000_001)).toBe(50_000_001);
    expect(capitalIncreaseRegistrationTax(50_000_000)).toBe(350_000);
    expect(capitalIncreaseRegistrationTax(1_000_000)).toBe(30_000);
  });

  it('役員の任期は選任後 n 年以内に終了する最後の事業年度の定時総会まで', () => {
    // 3 月決算（期首 4 月）、2024-06-25 選任、2 年 → 2026-03-31 期の定時総会（〜2026-06-30）
    expect(officerTermEnd('2024-06-25', 2, 4)).toEqual({ lastFiscalYearEnd: '2026-03-31', meetingDeadline: '2026-06-30' });
    // 12 月決算（期首 1 月）、2024-03-28 選任、10 年 → 2033-12-31 期
    expect(officerTermEnd('2024-03-28', 10, 1).lastFiscalYearEnd).toBe('2033-12-31');
  });

  it('任期の伸長は非公開会社だけ（最長 10 年）。監査役は 4 年より短くできない', () => {
    expect(officerTermYears('director', { ...DEFAULT_GOVERNANCE, directorTermYears: 10 })).toBe(10);
    expect(officerTermYears('director', { ...DEFAULT_GOVERNANCE, isPublicCompany: true, directorTermYears: 10 })).toBe(2);
    expect(officerTermYears('auditor', { ...DEFAULT_GOVERNANCE, auditorTermYears: 2 })).toBe(4);
    expect(officerTermYears('executive_officer', DEFAULT_GOVERNANCE)).toBeNull();
  });
});

describe('evaluateResolution', () => {
  it('普通決議: 過半数の出席と、出席の過半数の賛成', () => {
    expect(evaluateResolution('ordinary', { totalVotes: 10_000, presentVotes: 5_000, votesFor: 5_000 }).quorumMet).toBe(false);
    expect(evaluateResolution('ordinary', { totalVotes: 10_000, presentVotes: 6_000, votesFor: 3_000 }).approved).toBe(false);
    expect(evaluateResolution('ordinary', { totalVotes: 10_000, presentVotes: 6_000, votesFor: 3_001 }).approved).toBe(true);
  });

  it('特別決議: 出席の 3 分の 2 以上', () => {
    expect(evaluateResolution('special', { totalVotes: 10_000, presentVotes: 9_000, votesFor: 5_999 }).approved).toBe(false);
    const result = evaluateResolution('special', { totalVotes: 10_000, presentVotes: 9_000, votesFor: 6_000 });
    expect(result).toMatchObject({ approved: true, requiredFor: 6_000 });
  });

  it('309条4項: 総株主の半数以上、かつ総株主の議決権の 4 分の 3 以上', () => {
    const input = { totalVotes: 10_000, presentVotes: null, votesFor: 7_500, totalHolders: 5, holdersFor: 3 };
    expect(evaluateResolution('extraordinary_309_4', input).approved).toBe(true);
    expect(evaluateResolution('extraordinary_309_4', { ...input, holdersFor: 2 }).approved).toBe(false);
  });

  it('総株主の同意と取締役会決議', () => {
    expect(evaluateResolution('unanimous', { totalVotes: 10_000, presentVotes: null, votesFor: 9_999 }).approved).toBe(false);
    expect(evaluateResolution('board', { totalVotes: 3, presentVotes: 2, votesFor: 2 }).approved).toBe(true);
    expect(evaluateResolution('board', { totalVotes: 4, presentVotes: 2, votesFor: 2 }).quorumMet).toBe(false);
    expect(evaluateResolution('board', { totalVotes: null, presentVotes: null, votesFor: null }).approved).toBeNull();
  });
});

describe('税制適格ストックオプション', () => {
  const context = { establishedOn: '2024-04-01' };

  it('設立 5 年未満なら行使期間は 15 年まで、年間上限は実質 2,400 万円', () => {
    const plan = optionPlan('p', { resolutionDate: '2025-06-20', exercisePeriodStart: '2027-06-21', exercisePeriodEnd: '2040-06-20' });
    const results = checkPlanRequirements(plan, context);
    expect(results.find((item) => item.key === 'exercise_period')?.status).toBe('ok');
    expect(annualExerciseLimit(plan, context).limit).toBe(24_000_000);
    expect(annualExerciseLimit(plan, { establishedOn: '2015-04-01' }).limit).toBe(36_000_000);
    expect(annualExerciseLimit(plan, { establishedOn: '2000-04-01' }).limit).toBe(12_000_000);
  });

  it('決議から 2 年以内に始まる行使期間、時価を下回る行使価額、有償発行は不適合', () => {
    const plan = optionPlan('p', { exercisePeriodStart: '2027-06-20', exercisePrice: 400, fairValuePerShare: 500, issuePrice: 10 });
    const status = (key: string) => checkPlanRequirements(plan, context).find((item) => item.key === key)?.status;
    expect(status('exercise_period')).toBe('ng');
    expect(status('exercise_price')).toBe('ng');
    expect(status('issue_price')).toBe('ng');
  });

  it('3 分の 1 を超える大口株主と、役職員以外への付与は不適合', () => {
    const plan = optionPlan('p');
    const major = checkGrantRequirements({ plan, grant: optionGrant('g', 'p', 'yamada', 10, { holderRole: 'director' }), holdingRatioAtGrant: 0.8 });
    expect(major.find((item) => item.key === 'major_shareholder')?.status).toBe('ng');
    const other = checkGrantRequirements({ plan, grant: optionGrant('g', 'p', 'x', 10, { holderRole: 'other' }), holdingRatioAtGrant: 0 });
    expect(other.find((item) => item.key === 'eligible_person')?.status).toBe('ng');
  });

  it('年間の権利行使価額は、区分に応じて 2 または 3 で割ってから 1,200 万円と比べる', () => {
    const snapshot = sampleSnapshot();
    snapshot.optionPlans = [optionPlan('plan-1', { exercisePrice: 100_000 })];
    snapshot.optionGrants = [optionGrant('grant-suzuki', 'plan-1', 'suzuki', 400)];
    // 240 個 × 10 万円 = 2,400 万円 → ÷2 = 1,200 万円（上限ちょうど）
    snapshot.optionEvents = [optionEvent('grant-suzuki', 'exercise', '2028-02-01', 240)];
    expect(annualExerciseAmounts(snapshot, context)[0]).toMatchObject({ amount: 24_000_000, adjustedAmount: 12_000_000, exceeded: false });
    snapshot.optionEvents.push(optionEvent('grant-suzuki', 'exercise', '2028-09-01', 1));
    expect(annualExerciseAmounts(snapshot, context)[0].exceeded).toBe(true);
  });
});

describe('buildComplianceCalendar', () => {
  it('総会・申告・登記・調書・任期満了の期限を並べる', () => {
    const snapshot = sampleSnapshot();
    snapshot.fundingRounds = [
      {
        id: 'round-a', name: 'シリーズA', roundType: 'series_a', status: 'closed', shareClassId: null, closingDate: '2026-10-30',
        pricePerShare: 30_000, preMoneyValuation: null, targetAmount: null, resolutionDate: null, registrationDate: null,
        capitalIncreaseAmount: null, notes: '',
      },
    ];
    const tasks = buildComplianceCalendar({
      today: '2026-11-11',
      governance: DEFAULT_GOVERNANCE,
      fiscalYearStartMonth: 4,
      fiscalYears: [{ id: 'fy3', label: '第3期', startDate: '2026-04-01', endDate: '2027-03-31' }],
      meetings: [
        { id: 'm1', meetingType: 'board', title: '第20回取締役会', format: 'in_person', status: 'held', fiscalYearId: null, heldOn: '2026-09-15', noticeSentOn: '2026-09-01', minutesFinalizedOn: null },
      ],
      officers: [{ id: 'o1', name: '山田 太郎', position: 'representative_director', appointedOn: '2025-06-25', termExpiresOn: null, retiredOn: null, registeredOn: null }],
      snapshot,
    });
    const byKey = new Map(tasks.map((task) => [task.key, task]));
    expect(byKey.get('agm:fy3')?.dueOn).toBe('2027-06-30');
    expect(byKey.get('tax:fy3')?.dueOn).toBe('2027-05-31');
    expect(byKey.get('round-registration:round-a')).toMatchObject({ dueOn: '2026-11-13', status: 'soon' });
    expect(byKey.get('minutes:m1')?.status).toBe('overdue');
    expect(byKey.get('board-report')?.dueOn).toBe('2026-12-15');
    expect(byKey.get('officer-term:o1')?.dueOn).toBe('2027-06-30');
    expect(tasks[0].status).toBe('overdue');
  });
});

describe('手続きの完了の記録', () => {
  const input = {
    today: '2027-06-15',
    governance: DEFAULT_GOVERNANCE,
    fiscalYearStartMonth: 4,
    fiscalYears: [{ id: 'fy3', label: '第3期', startDate: '2026-04-01', endDate: '2027-03-31' }],
    meetings: [],
    officers: [],
    snapshot: sampleSnapshot(),
  };

  it('台帳に日付の項目が無い手続きは、人が記録した完了で完了になる', () => {
    const before = buildComplianceCalendar(input).find((task) => task.key === 'tax:fy3');
    expect(before).toMatchObject({ status: 'overdue', tracking: 'manual', completedOn: null });
    const after = buildComplianceCalendar({
      ...input,
      completions: { 'tax:fy3': { completedOn: '2027-05-28', note: 'e-Tax' } },
    }).find((task) => task.key === 'tax:fy3');
    expect(after).toMatchObject({ status: 'done', completedOn: '2027-05-28', completionNote: 'e-Tax' });
  });

  it('台帳の日付から判定する手続きは、人の記録では完了にならない', () => {
    const tasks = buildComplianceCalendar({ ...input, completions: { 'agm:fy3': { completedOn: '2027-06-01', note: '' } } });
    expect(tasks.find((task) => task.key === 'agm:fy3')).toMatchObject({ tracking: 'ledger', status: 'soon', completedOn: null });
  });
});
