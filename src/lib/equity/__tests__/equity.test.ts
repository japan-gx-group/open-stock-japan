import { describe, expect, it } from 'vitest';
import { buildCapTable, NEW_INVESTOR_ROW_ID, POOL_ROW_ID, postMoneyValuation, pricePerShareFromPreMoney } from '../capTable';
import { addMonths, ceilYen, formatDateWareki, formatYenJa, fullMonthsBetween, parseNumberText } from '../format';
import { buildRegistry, checkLedger, splitAdjustments } from '../ledger';
import { exercisableUnits, exercisePeriodState, vestingStatus } from '../vesting';
import { computeWaterfall } from '../waterfall';
import {
  COMMON,
  SERIES_A,
  optionEvent,
  optionGrant,
  optionPlan,
  sampleSnapshot,
  shareClass,
  stakeholder,
  transaction,
} from './fixture';

describe('parseNumberText', () => {
  it('カンマ・全角・単位つきの入力を数値にする', () => {
    expect(parseNumberText('50,000,000')).toBe(50_000_000);
    expect(parseNumberText('５，０００万円')).toBe(50_000_000);
    expect(parseNumberText('1.1億')).toBe(110_000_000);
    expect(parseNumberText('1億5000万')).toBe(150_000_000);
    expect(parseNumberText('3億5,000万円')).toBe(350_000_000);
    expect(parseNumberText('-200株')).toBe(-200);
    expect(parseNumberText('20%')).toBe(20);
  });

  it('解釈できない入力は null', () => {
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('約1億')).toBeNull();
    expect(parseNumberText('abc')).toBeNull();
    expect(parseNumberText(null)).toBeNull();
  });
});

describe('表示と日付', () => {
  it('万・億で表示する', () => {
    expect(formatYenJa(50_000_000)).toBe('5,000万円');
    expect(formatYenJa(110_000_000)).toBe('1億1,000万円');
    expect(formatYenJa(1_234)).toBe('1,234円');
    expect(formatYenJa(null)).toBe('—');
  });

  it('円未満切り上げは浮動小数の誤差で繰り上がらない', () => {
    expect(ceilYen(500.0000000001)).toBe(500);
    expect(ceilYen(500.01)).toBe(501);
  });

  it('月の加算は応当日が無ければ月末に寄せる', () => {
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2025-03-15', 12)).toBe('2026-03-15');
  });

  it('満月数は応当日の前日まで数えない', () => {
    expect(fullMonthsBetween('2025-07-01', '2026-06-30')).toBe(11);
    expect(fullMonthsBetween('2025-07-01', '2026-07-01')).toBe(12);
    expect(fullMonthsBetween('2025-07-01', '2025-06-01')).toBe(0);
  });

  it('和暦で表示する', () => {
    expect(formatDateWareki('2026-11-11')).toBe('令和8年11月11日');
  });
});

describe('buildCapTable', () => {
  it('発行済・新株予約権・転換型を合わせた完全希釈化後の比率を出す', () => {
    const table = buildCapTable(sampleSnapshot());
    expect(table.totals.issuedShares).toBe(10_000);
    expect(table.totals.paidIn).toBe(1_000_000);
    expect(table.totals.optionShares).toBe(500);
    expect(table.totals.unallocatedPoolShares).toBe(500);
    // 転換の基準 = 発行済 10,000 + 未行使 SO 500 = 10,500 株
    expect(table.totals.conversionBaseShares).toBe(10_500);
    // キャップ価格 = 3 億 ÷ 10,500 = 28,571.4… → 28,572 円（円未満切り上げ）
    expect(table.conversions[0].capPrice).toBe(28_572);
    expect(table.conversions[0].basis).toBe('cap');
    // 3,000 万 ÷ 28,572 = 1,049.97… → 1,049 株（株未満切り捨て）
    expect(table.totals.convertibleShares).toBe(1_049);
    expect(table.totals.fullyDilutedShares).toBe(10_000 + 500 + 500 + 1_049);

    const yamada = table.rows.find((row) => row.stakeholderId === 'yamada');
    expect(yamada?.issuedRatio).toBeCloseTo(0.8);
    expect(yamada?.fullyDilutedRatio).toBeCloseTo(8000 / 12_049);
    expect(table.rows.at(-1)?.stakeholderId).toBe(POOL_ROW_ID);
    expect(table.totals.shareholderCount).toBe(2);
  });

  it('次回調達の単価が低いとディスカウントで転換し、新規投資家の行が増える', () => {
    const table = buildCapTable(sampleSnapshot(), {
      scenario: { pricePerShare: 20_000, newMoney: 100_000_000, newInvestorName: 'みらいVC', additionalPoolShares: 0 },
    });
    // ディスカウント価格 = 20,000 × 0.8 = 16,000 円 < キャップ価格 28,572 円
    expect(table.conversions[0].basis).toBe('discount');
    expect(table.conversions[0].conversionPrice).toBe(16_000);
    expect(table.totals.convertibleShares).toBe(1_875);
    const investor = table.rows.find((row) => row.stakeholderId === NEW_INVESTOR_ROW_ID);
    expect(investor?.name).toBe('みらいVC');
    expect(investor?.newShares).toBe(5_000);
    expect(postMoneyValuation(table)).toBe(table.totals.fullyDilutedShares * 20_000);
  });

  it('キャップもシナリオも無い転換型は転換株式数を出さない', () => {
    const snapshot = sampleSnapshot();
    snapshot.convertibleRounds[0].valuationCap = null;
    const table = buildCapTable(snapshot);
    expect(table.conversions[0].basis).toBe('undetermined');
    expect(table.totals.convertibleShares).toBe(0);
    expect(table.totals.convertibleAmount).toBe(30_000_000);
  });

  it('転換済み・償還済みの転換型と、行使・失効した新株予約権は数えない', () => {
    const snapshot = sampleSnapshot();
    snapshot.convertibleInvestments[0].convertedShares = 1_000;
    snapshot.convertibleInvestments[0].convertedOn = '2026-03-01';
    snapshot.optionEvents = [optionEvent('grant-suzuki', 'exercise', '2027-08-01', 100), optionEvent('grant-tanaka', 'forfeit', '2026-01-31', 100)];
    const table = buildCapTable(snapshot);
    expect(table.totals.convertibleAmount).toBe(0);
    expect(table.totals.optionShares).toBe(300);
    expect(table.totals.optionUnitsGranted).toBe(500);
    expect(table.totals.optionUnitsRemaining).toBe(300);
    // 失効した 100 個は枠に戻らない: 1,000 − 500 = 500
    expect(table.totals.unallocatedPoolShares).toBe(500);
  });

  it('基準日を指定するとその日までの異動だけで集計する', () => {
    const snapshot = sampleSnapshot();
    snapshot.shareTransactions.push(
      transaction('sato', COMMON, '2025-10-01', -500, { transactionType: 'transfer', groupId: 'g1' }),
      transaction('suzuki', COMMON, '2025-10-01', 500, { transactionType: 'transfer', groupId: 'g1' }),
    );
    const before = buildCapTable(snapshot, { asOf: '2024-12-31' });
    expect(before.rows.map((row) => row.stakeholderId)).toEqual(['yamada', 'sato']);
    expect(before.totals.optionShares).toBe(0);
    expect(before.totals.convertibleAmount).toBe(0);

    const after = buildCapTable(snapshot, { asOf: '2025-12-31' });
    expect(after.rows.find((row) => row.stakeholderId === 'sato')?.issuedShares).toBe(1_500);
    expect(after.rows.find((row) => row.stakeholderId === 'suzuki')?.issuedShares).toBe(500);
    expect(after.totals.issuedShares).toBe(10_000);
    // 譲渡で入った金額は会社への払込ではない
    expect(after.totals.paidIn).toBe(1_000_000);
  });

  it('種類株式は転換比率で普通株に換算し、議決権のない種類は議決権比率から外す', () => {
    const snapshot = sampleSnapshot();
    snapshot.convertibleRounds = [];
    snapshot.convertibleInvestments = [];
    snapshot.optionPlans = [];
    snapshot.optionGrants = [];
    snapshot.shareClasses.push(
      shareClass(SERIES_A, 'A種優先株式', { kind: 'preferred', conversionRatio: 1.25, originalIssuePrice: 30_000, sortOrder: 1 }),
      shareClass('class-nv', '無議決権株式', { kind: 'other', hasVotingRights: false, sortOrder: 2 }),
    );
    snapshot.shareTransactions.push(
      transaction('aozora', SERIES_A, '2026-01-10', 2_000, { pricePerShare: 30_000, amount: 60_000_000 }),
      transaction('suzuki', 'class-nv', '2026-01-10', 1_000),
    );
    const table = buildCapTable(snapshot);
    expect(table.totals.issuedShares).toBe(13_000);
    expect(table.totals.convertedShares).toBe(10_000 + 2_500 + 1_000);
    expect(table.totals.votingShares).toBe(12_000);
    const fund = table.rows.find((row) => row.stakeholderId === 'aozora');
    expect(fund?.votingRatio).toBeCloseTo(2_000 / 12_000);
    expect(fund?.fullyDilutedRatio).toBeCloseTo(2_500 / 13_500);
    expect(table.classes.find((item) => item.shareClassId === SERIES_A)).toMatchObject({ issuedShares: 2_000, convertedShares: 2_500, holderCount: 1 });
  });

  it('空の台帳でも落ちない', () => {
    const snapshot = sampleSnapshot();
    const table = buildCapTable({ ...snapshot, shareTransactions: [], convertibleInvestments: [], optionGrants: [], optionPlans: [] });
    expect(table.rows).toEqual([]);
    expect(table.totals.fullyDilutedShares).toBe(0);
  });
});

describe('pricePerShareFromPreMoney', () => {
  it('転換型を含めない基準では プレマネー ÷（発行済 + SO + 未割当枠）', () => {
    // 10,000 + 500 + 500 = 11,000 株
    expect(pricePerShareFromPreMoney(sampleSnapshot(), 550_000_000)).toBe(50_000);
  });

  it('転換型を含める基準では単価が収束するまで計算し、プレマネーを超えない範囲に収まる', () => {
    const snapshot = sampleSnapshot();
    const price = pricePerShareFromPreMoney(snapshot, 550_000_000, 'including_convertibles');
    expect(price).not.toBeNull();
    const table = buildCapTable(snapshot, {
      scenario: { pricePerShare: price, newMoney: 0, newInvestorName: '', additionalPoolShares: 0 },
    });
    const implied = (price as number) * table.totals.fullyDilutedShares;
    expect(implied).toBeGreaterThanOrEqual(550_000_000);
    expect(implied - 550_000_000).toBeLessThan(table.totals.fullyDilutedShares);
  });

  it('株式が無い・評価額が 0 以下なら null', () => {
    expect(pricePerShareFromPreMoney(sampleSnapshot(), 0)).toBeNull();
    expect(pricePerShareFromPreMoney({ ...sampleSnapshot(), shareTransactions: [], optionGrants: [], optionPlans: [] }, 1_000_000)).toBeNull();
  });
});

describe('buildRegistry / checkLedger', () => {
  it('株主名簿は株主 × 種類ごとに株式数と取得日を出す', () => {
    const snapshot = sampleSnapshot();
    snapshot.shareTransactions.push(transaction('yamada', COMMON, '2025-05-01', 1_000, { pricePerShare: 1_000, amount: 1_000_000 }));
    const registry = buildRegistry(snapshot);
    expect(registry.totalShares).toBe(11_000);
    expect(registry.shareholderCount).toBe(2);
    expect(registry.rows[0]).toMatchObject({
      name: '山田 太郎',
      shares: 9_000,
      firstAcquiredOn: '2024-04-01',
      lastAcquiredOn: '2025-05-01',
      shareClassName: '普通株式',
    });
    expect(registry.rows[0].totalRatio).toBeCloseTo(9_000 / 11_000);
    expect(buildRegistry(snapshot, '2024-12-31').totalShares).toBe(10_000);
  });

  it('全部譲渡した株主は名簿から外れ、再取得した日が取得日になる', () => {
    const snapshot = sampleSnapshot();
    snapshot.shareTransactions.push(
      transaction('sato', COMMON, '2025-02-01', -2_000, { transactionType: 'transfer', groupId: 'g1' }),
      transaction('yamada', COMMON, '2025-02-01', 2_000, { transactionType: 'transfer', groupId: 'g1' }),
    );
    expect(buildRegistry(snapshot).rows.map((row) => row.name)).toEqual(['山田 太郎']);
    snapshot.shareTransactions.push(transaction('sato', COMMON, '2026-02-01', 100));
    const sato = buildRegistry(snapshot).rows.find((row) => row.stakeholderId === 'sato');
    expect(sato?.firstAcquiredOn).toBe('2026-02-01');
  });

  it('持株がマイナスになる譲渡、住所の未入力、発行可能株式総数の超過、割当の超過を検出する', () => {
    const snapshot = sampleSnapshot();
    snapshot.stakeholders[1].address = '';
    snapshot.shareTransactions.push(transaction('suzuki', COMMON, '2025-03-01', -10, { transactionType: 'transfer' }));
    snapshot.optionGrants.push(optionGrant('grant-over', 'plan-1', 'suzuki', 600));
    const codes = checkLedger(snapshot, { authorizedShares: 9_000 }).map((issue) => issue.code);
    expect(codes).toContain('negative_balance');
    expect(codes).toContain('transfer_unbalanced');
    expect(codes).toContain('missing_address');
    expect(codes).toContain('exceeds_authorized');
    expect(codes).toContain('option_pool_overallocated');
  });

  it('整合している台帳では何も出さない', () => {
    expect(checkLedger(sampleSnapshot(), { authorizedShares: 100_000 })).toEqual([]);
  });

  it('株式分割で増える株式数を株主ごとに出す', () => {
    const rows = splitAdjustments(sampleSnapshot(), COMMON, 100, '2026-01-01');
    expect(rows).toEqual([
      { stakeholderId: 'yamada', before: 8_000, after: 800_000, delta: 792_000 },
      { stakeholderId: 'sato', before: 2_000, after: 200_000, delta: 198_000 },
    ]);
  });
});

describe('vesting', () => {
  const plan = optionPlan('plan');
  const grant = optionGrant('grant', 'plan', 'suzuki', 480);

  it('クリフまでは 0、クリフで 12/48、以降は毎月確定する', () => {
    expect(vestingStatus(grant, plan, '2026-06-30').vestedUnits).toBe(0);
    expect(vestingStatus(grant, plan, '2026-07-01').vestedUnits).toBe(120);
    expect(vestingStatus(grant, plan, '2026-08-01').vestedUnits).toBe(130);
    expect(vestingStatus(grant, plan, '2029-07-01')).toMatchObject({ vestedUnits: 480, unvestedUnits: 0, fullyVestedOn: '2029-07-01', cliffOn: '2026-07-01' });
  });

  it('年ごとの区切りでは区切りの日にまとめて確定する', () => {
    const yearly = optionPlan('plan', { vestingInterval: 'yearly', cliffMonths: 0 });
    expect(vestingStatus(grant, yearly, '2026-06-30').vestedUnits).toBe(0);
    expect(vestingStatus(grant, yearly, '2027-06-30').vestedUnits).toBe(120);
    expect(vestingStatus(grant, yearly, '2027-07-01').vestedUnits).toBe(240);
  });

  it('ベスティングの定めが無ければ全量を確定済みとして扱う', () => {
    expect(vestingStatus(grant, optionPlan('plan', { vestingMonths: null }), '2025-07-01').vestedUnits).toBe(480);
  });

  it('行使できる個数は確定済みから行使済みを引き、失効分を超えない', () => {
    expect(exercisableUnits(120, 20, 0, 480)).toBe(100);
    expect(exercisableUnits(480, 100, 300, 480)).toBe(80);
    expect(exercisableUnits(0, 0, 0, 480)).toBe(0);
  });

  it('行使期間の状態を返す', () => {
    expect(exercisePeriodState(plan, '2027-07-01')).toBe('before');
    expect(exercisePeriodState(plan, '2027-07-02')).toBe('open');
    expect(exercisePeriodState(plan, '2035-06-20')).toBe('closed');
    expect(exercisePeriodState(optionPlan('p', { exercisePeriodStart: null, exercisePeriodEnd: null }), '2030-01-01')).toBe('unset');
  });
});

describe('computeWaterfall', () => {
  const common = shareClass(COMMON, '普通株式');
  const seriesA = (patch = {}) =>
    shareClass(SERIES_A, 'A種優先株式', { kind: 'preferred', seniority: 1, originalIssuePrice: 10_000, sortOrder: 1, ...patch });
  const holdings = [
    { shareClassId: COMMON, shares: 8_000 },
    { shareClassId: SERIES_A, shares: 2_000 },
  ];
  const totalOf = (result: ReturnType<typeof computeWaterfall>, id: string) => result.classes.find((item) => item.shareClassId === id)?.total;

  it('非参加型: 低い売却額では優先分配、高い売却額では普通株に転換する', () => {
    const low = computeWaterfall(30_000_000, [common, seriesA()], holdings);
    expect(totalOf(low, SERIES_A)).toBe(20_000_000);
    expect(totalOf(low, COMMON)).toBe(10_000_000);
    expect(low.classes[0].converted).toBe(false);

    const high = computeWaterfall(200_000_000, [common, seriesA()], holdings);
    expect(totalOf(high, SERIES_A)).toBe(40_000_000);
    expect(totalOf(high, COMMON)).toBe(160_000_000);
    expect(high.classes[0].converted).toBe(true);
  });

  it('参加型: 優先分配のあと残りも持株比率で受け取る', () => {
    const result = computeWaterfall(120_000_000, [common, seriesA({ participation: 'participating' })], holdings);
    // 優先 2,000 万 + 残り 1 億 × 20% = 4,000 万
    expect(totalOf(result, SERIES_A)).toBe(40_000_000);
    expect(totalOf(result, COMMON)).toBe(80_000_000);
  });

  it('上限つき参加型: 上限（3 倍）で止まり、さらに高い売却額では転換する', () => {
    const classes = [common, seriesA({ participation: 'capped_participating', participationCapMultiple: 3 })];
    const capped = computeWaterfall(250_000_000, classes, holdings);
    // 上限なしなら 2,000 万 + 2.3 億 × 20% = 6,600 万 → 上限 6,000 万
    expect(totalOf(capped, SERIES_A)).toBe(60_000_000);
    expect(totalOf(capped, COMMON)).toBe(190_000_000);

    const converted = computeWaterfall(400_000_000, classes, holdings);
    expect(totalOf(converted, SERIES_A)).toBe(80_000_000);
    expect(converted.classes[0].converted).toBe(true);
  });

  it('売却額が優先分配に届かないときは優先順位の高い種類から配る', () => {
    const seriesB = shareClass('class-b', 'B種優先株式', { kind: 'preferred', seniority: 2, originalIssuePrice: 50_000, sortOrder: 2 });
    const result = computeWaterfall(60_000_000, [common, seriesA(), seriesB], [...holdings, { shareClassId: 'class-b', shares: 1_000 }]);
    expect(totalOf(result, 'class-b')).toBe(50_000_000);
    expect(totalOf(result, SERIES_A)).toBe(10_000_000);
    expect(totalOf(result, COMMON)).toBe(0);
    expect(result.undistributed).toBe(0);
  });

  it('関係者のいない台帳では空の結果を返す', () => {
    expect(computeWaterfall(1_000_000, [common], []).classes).toEqual([]);
    expect(stakeholder('x', 'x').name).toBe('x');
  });
});

describe('ポストマネー基準のキャップ（J-KISS 2.0）', () => {
  it('転換後の株式を含めた株式数で割るので、投資家の転換後の持分が 投資額 ÷ キャップ に近づく', () => {
    const snapshot = sampleSnapshot();
    snapshot.convertibleRounds[0].capBasis = 'post_money';
    const table = buildCapTable(snapshot, { includeUnallocatedPool: false });
    const detail = table.conversions[0];
    expect(detail.basis).toBe('cap');
    // プレマネー基準の 28,572 円より低い転換価額になる
    expect(detail.conversionPrice).toBeLessThan(28_572);
    // 転換価額 × (基準株式数 + 転換株式数) がキャップをわずかに上回る範囲に収束している
    const implied = detail.conversionPrice * (table.totals.conversionBaseShares + detail.totalShares);
    expect(implied).toBeGreaterThanOrEqual(300_000_000);
    expect(implied - 300_000_000).toBeLessThan(detail.conversionPrice + table.totals.conversionBaseShares);
    // 3,000 万 ÷ 3 億 = 10%
    const fund = table.rows.find((row) => row.stakeholderId === 'aozora');
    expect(fund?.fullyDilutedRatio).toBeCloseTo(0.1, 3);
  });
});
