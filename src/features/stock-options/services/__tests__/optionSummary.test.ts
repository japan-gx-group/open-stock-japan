import { describe, expect, it } from 'vitest';
import { COMMON, optionEvent, optionGrant, optionPlan, sampleSnapshot, transaction } from '@/lib/equity/__tests__/fixture';
import {
  buildPlanViews,
  buildWarrantRegister,
  exerciseTransactionDefaults,
  findExerciseTransaction,
  holdingRatioAt,
  majorShareholderCheckDate,
  summarizePlans,
  vestingSchedule,
} from '../optionSummary';

// fixture の回次: 1,000 個・割当日 2025-07-01・48 か月（クリフ 12 か月・毎月）・行使期間 2027-07-02〜2035-06-19
const TODAY = '2026-11-11';

describe('buildPlanViews', () => {
  it('回次ごとに割当・行使・失効・残数・未割当を集計する', () => {
    const snapshot = sampleSnapshot();
    snapshot.optionEvents = [
      optionEvent('grant-suzuki', 'exercise', '2026-08-01', 50),
      optionEvent('grant-tanaka', 'forfeit', '2026-01-31', 40),
    ];
    const [view] = buildPlanViews(snapshot, TODAY);
    expect(view.grantedUnits).toBe(500);
    expect(view.exercisedUnits).toBe(50);
    expect(view.forfeitedUnits).toBe(40);
    expect(view.remainingUnits).toBe(410);
    // 失効した分は未割当に戻さない: 1,000 − 500
    expect(view.unallocatedUnits).toBe(500);
    expect(view.overAllocatedUnits).toBe(0);
    expect(view.periodState).toBe('before');

    const totals = summarizePlans([view]);
    expect(totals.totalUnits).toBe(1000);
    // 発行総数 = 未割当 + 未行使 + 行使済み + 失効
    expect(totals.unallocatedUnits + totals.remainingUnits + totals.exercisedUnits + totals.forfeitedUnits).toBe(totals.totalUnits);
  });

  it('割当ごとに確定済み・行使可能数・次の節目を出す', () => {
    const snapshot = sampleSnapshot();
    snapshot.optionEvents = [optionEvent('grant-suzuki', 'exercise', '2026-08-01', 50)];
    const [view] = buildPlanViews(snapshot, TODAY);
    const suzuki = view.grants.find((grant) => grant.grant.id === 'grant-suzuki');
    // 2025-07-01 から満 16 か月 → 400 × 16 / 48 = 133 個
    expect(suzuki?.vesting.vestedUnits).toBe(133);
    expect(suzuki?.exercisableUnits).toBe(83);
    expect(suzuki?.remainingUnits).toBe(350);
    expect(suzuki?.milestone).toEqual({ kind: 'full', date: '2029-07-01' });
    expect(suzuki?.holderName).toBe('鈴木 一郎');
    expect(suzuki?.acquiredOn).toBe('2025-07-01');
  });

  it('クリフ前・全量確定後・ベスティングなしの節目', () => {
    const snapshot = sampleSnapshot();
    expect(buildPlanViews(snapshot, '2026-03-01')[0].grants[0].milestone).toEqual({ kind: 'cliff', date: '2026-07-01' });
    expect(buildPlanViews(snapshot, '2029-07-01')[0].grants[0].milestone).toEqual({ kind: 'done', date: '2029-07-01' });
    snapshot.optionPlans = [optionPlan('plan-1', { vestingMonths: null, cliffMonths: null })];
    expect(buildPlanViews(snapshot, TODAY)[0].grants[0].milestone).toEqual({ kind: 'none', date: null });
  });

  it('登記の状況（割当日から 2 週間）を判定する', () => {
    const snapshot = sampleSnapshot();
    expect(buildPlanViews(snapshot, '2025-07-15')[0].registration).toEqual({ state: 'pending', deadline: '2025-07-15' });
    expect(buildPlanViews(snapshot, '2025-07-16')[0].registration.state).toBe('overdue');
    snapshot.optionPlans = [optionPlan('plan-1', { registeredOn: '2025-07-10' })];
    expect(buildPlanViews(snapshot, TODAY)[0].registration.state).toBe('registered');
    snapshot.optionPlans = [optionPlan('plan-1', { allotmentDate: null })];
    expect(buildPlanViews(snapshot, TODAY)[0].registration).toEqual({ state: 'unknown', deadline: null });
  });

  it('割当が発行総数を超えたら超過分を返す', () => {
    const snapshot = sampleSnapshot();
    snapshot.optionGrants.push(optionGrant('grant-extra', 'plan-1', 'sato', 600));
    const [view] = buildPlanViews(snapshot, TODAY);
    expect(view.unallocatedUnits).toBe(0);
    expect(view.overAllocatedUnits).toBe(100);
  });
});

describe('大口株主の判定の材料', () => {
  it('基準日は発行決議日、無ければ割当日', () => {
    expect(majorShareholderCheckDate({ resolutionDate: '2025-06-20', allotmentDate: '2025-07-01' }, { grantedOn: '2025-07-01' })).toBe('2025-06-20');
    expect(majorShareholderCheckDate({ resolutionDate: null, allotmentDate: '2025-07-01' }, { grantedOn: '2025-07-05' })).toBe('2025-07-05');
    expect(majorShareholderCheckDate({ resolutionDate: null, allotmentDate: null }, { grantedOn: null })).toBeNull();
  });

  it('基準日の発行済株式に対する持株比率を返す', () => {
    const snapshot = sampleSnapshot();
    expect(holdingRatioAt(snapshot, 'yamada', '2025-06-20')).toBeCloseTo(0.8);
    expect(holdingRatioAt(snapshot, 'suzuki', '2025-06-20')).toBe(0);
    // 設立前は発行済株式が無いので判定できない
    expect(holdingRatioAt(snapshot, 'yamada', '2024-03-31')).toBeNull();
    expect(holdingRatioAt(snapshot, 'yamada', null)).toBeNull();
    // 基準日より後の取得は数えない
    snapshot.shareTransactions.push(transaction('suzuki', COMMON, '2025-12-01', 10_000));
    expect(holdingRatioAt(snapshot, 'suzuki', '2025-06-20')).toBe(0);
    expect(holdingRatioAt(snapshot, 'suzuki', '2025-12-01')).toBeCloseTo(0.5);
  });
});

describe('vestingSchedule', () => {
  it('クリフで 12 か月分が確定し、その後は毎月、最後に全量になる', () => {
    const points = vestingSchedule({ units: 480, vestingStartOn: null, grantedOn: '2025-07-01' }, optionPlan('plan-1'));
    expect(points[0]).toEqual({ date: '2025-07-01', vestedUnits: 0 });
    expect(points[1]).toEqual({ date: '2026-07-01', vestedUnits: 120 });
    expect(points[2]).toEqual({ date: '2026-08-01', vestedUnits: 130 });
    expect(points[points.length - 1]).toEqual({ date: '2029-07-01', vestedUnits: 480 });
    expect(points).toHaveLength(1 + 1 + 36);
  });

  it('ベスティングの定めが無ければ空', () => {
    expect(vestingSchedule({ units: 480, vestingStartOn: null, grantedOn: '2025-07-01' }, optionPlan('plan-1', { vestingMonths: null }))).toEqual([]);
  });
});

describe('buildWarrantRegister', () => {
  it('残数のある割当と未転換の J-KISS を、氏名・住所・内容・数・取得日で並べる', () => {
    const snapshot = sampleSnapshot();
    snapshot.optionPlans = [optionPlan('plan-1', { shareClassId: COMMON })];
    snapshot.optionEvents = [
      optionEvent('grant-suzuki', 'exercise', '2026-08-01', 50),
      optionEvent('grant-tanaka', 'forfeit', '2026-01-31', 100),
    ];
    const rows = buildWarrantRegister(snapshot, TODAY);
    // 田中は全量が失効して新株予約権者でなくなったので載らない
    expect(rows.map((row) => row.holderName)).toEqual(['青空1号投資事業有限責任組合', '鈴木 一郎'].sort((a, b) => a.localeCompare(b, 'ja')));
    const suzuki = rows.find((row) => row.stakeholderId === 'suzuki');
    expect(suzuki).toMatchObject({
      planName: '第1回新株予約権',
      units: 350,
      acquiredOn: '2025-07-01',
      address: '東京都千代田区架空町1-1-1',
    });
    expect(suzuki?.content).toContain('普通株式 1株');
    expect(suzuki?.content).toContain('行使価額: 1 株 500円');
    expect(suzuki?.note).toContain('行使 50個');
    const fund = rows.find((row) => row.stakeholderId === 'aozora');
    expect(fund).toMatchObject({ units: null, acquiredOn: '2025-01-15' });
    expect(fund?.note).toContain('3,000万円');
  });

  it('転換済みの投資と、未転換でない回次は載せない', () => {
    const snapshot = sampleSnapshot();
    snapshot.optionGrants = [];
    snapshot.convertibleInvestments[0].convertedShares = 1000;
    snapshot.convertibleInvestments[0].convertedOn = '2026-10-30';
    expect(buildWarrantRegister(snapshot, TODAY)).toEqual([]);
  });
});

describe('行使の株式の異動への引き継ぎ', () => {
  it('株式数 = 個数 × 1 個あたりの株式数、単価 = 行使価額で初期値を作る', () => {
    const defaults = exerciseTransactionDefaults(
      { name: '第1回新株予約権', shareClassId: COMMON, sharesPerUnit: 10, exercisePrice: 500 },
      'suzuki',
      '2026-08-01',
      120,
    );
    expect(defaults).toEqual({
      stakeholderId: 'suzuki',
      shareClassId: COMMON,
      transactionType: 'exercise',
      transactionDate: '2026-08-01',
      shares: '1,200',
      pricePerShare: '500',
      amount: '600,000',
      notes: '第1回新株予約権の行使（120個）',
    });
  });

  it('同じ株主・同じ日・同じ株式数の行使の異動を探す', () => {
    const match = transaction('suzuki', COMMON, '2026-08-01', 50, { transactionType: 'exercise' });
    const others = [transaction('suzuki', COMMON, '2026-08-01', 50), transaction('tanaka', COMMON, '2026-08-01', 50, { transactionType: 'exercise' })];
    expect(findExerciseTransaction(others, 'suzuki', '2026-08-01', 50)).toBeNull();
    expect(findExerciseTransaction([...others, match], 'suzuki', '2026-08-01', 50)).toBe(match);
  });
});
