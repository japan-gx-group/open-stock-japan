import { describe, expect, it } from 'vitest';
import { buildCapTable } from '@/lib/equity/capTable';
import { convertibleInvestment, convertibleRound, sampleSnapshot, transaction, COMMON } from '@/lib/equity/__tests__/fixture';
import {
  buildRoundViews,
  conversionTransactionDefaults,
  deadlineStatus,
  findConversionTransaction,
  qualifiedFinancingState,
  summarizeRounds,
} from '../convertibleSummary';

const TODAY = '2026-11-11';

describe('deadlineStatus', () => {
  it('期限までの日数と状態を返す', () => {
    expect(deadlineStatus(null, TODAY)).toEqual({ state: 'none', daysLeft: null });
    expect(deadlineStatus('2026-11-11', TODAY)).toEqual({ state: 'soon', daysLeft: 0 });
    expect(deadlineStatus('2026-11-10', TODAY)).toEqual({ state: 'overdue', daysLeft: -1 });
    expect(deadlineStatus('2027-02-09', TODAY)).toEqual({ state: 'soon', daysLeft: 90 });
    expect(deadlineStatus('2027-02-10', TODAY)).toEqual({ state: 'upcoming', daysLeft: 91 });
  });
});

describe('qualifiedFinancingState', () => {
  it('調達額が適格資金調達の金額以上なら reached', () => {
    const round = { qualifiedFinancingAmount: 100_000_000 };
    expect(qualifiedFinancingState(round, 100_000_000)).toBe('reached');
    expect(qualifiedFinancingState(round, 99_999_999)).toBe('not_reached');
    expect(qualifiedFinancingState(round, null)).toBe('unknown');
    expect(qualifiedFinancingState({ qualifiedFinancingAmount: null }, 500_000_000)).toBe('unknown');
  });
});

describe('buildRoundViews / summarizeRounds', () => {
  it('未転換の投資に概算の転換株式数を付ける', () => {
    const snapshot = sampleSnapshot();
    snapshot.convertibleRounds[0].conversionDeadline = '2026-07-15';
    const views = buildRoundViews(snapshot, buildCapTable(snapshot), TODAY);
    expect(views).toHaveLength(1);
    // キャップ 3 億 ÷（10,000 + 500）= 28,572 円 → 3,000 万 ÷ 28,572 = 1,049 株
    expect(views[0].conversion?.capPrice).toBe(28_572);
    expect(views[0].investments[0].estimatedShares).toBe(1_049);
    expect(views[0].outstandingAmount).toBe(30_000_000);
    expect(views[0].deadline.state).toBe('overdue');

    const totals = summarizeRounds(views);
    expect(totals.totalAmount).toBe(30_000_000);
    expect(totals.estimatedShares).toBe(1_049);
    expect(totals.hasUndetermined).toBe(false);
    expect(totals.nextDeadline?.date).toBe('2026-07-15');
  });

  it('次回調達の単価を入れるとディスカウント基準に切り替わる', () => {
    const snapshot = sampleSnapshot();
    const scenario = { pricePerShare: 20_000, newMoney: 150_000_000, newInvestorName: '', additionalPoolShares: 0 };
    const views = buildRoundViews(snapshot, buildCapTable(snapshot, { scenario }), TODAY, scenario.newMoney);
    expect(views[0].conversion?.basis).toBe('discount');
    expect(views[0].conversion?.conversionPrice).toBe(16_000);
    expect(views[0].investments[0].estimatedShares).toBe(1_875);
    expect(views[0].qualified).toBe('reached');
  });

  it('転換済みの投資は概算を出さず、残高と期限から外す', () => {
    const snapshot = sampleSnapshot();
    snapshot.convertibleRounds[0].conversionDeadline = '2026-07-15';
    snapshot.convertibleInvestments[0].convertedShares = 1_049;
    snapshot.convertibleInvestments[0].convertedOn = '2026-10-30';
    let views = buildRoundViews(snapshot, buildCapTable(snapshot), TODAY);
    expect(views[0].conversion).toBeNull();
    expect(views[0].investments[0]).toMatchObject({ converted: true, estimatedShares: null, hasTransaction: false });
    expect(views[0].outstandingAmount).toBe(0);
    expect(views[0].convertedShares).toBe(1_049);
    expect(views[0].deadline.state).toBe('none');
    expect(summarizeRounds(views)).toMatchObject({ totalAmount: 30_000_000, outstandingAmount: 0, estimatedShares: 0, nextDeadline: null });

    snapshot.shareTransactions.push(transaction('aozora', COMMON, '2026-10-30', 1_049, { transactionType: 'conversion' }));
    views = buildRoundViews(snapshot, buildCapTable(snapshot), TODAY);
    expect(views[0].investments[0].hasTransaction).toBe(true);
  });

  it('キャップなしで単価も無い回次は「決められない」として数える', () => {
    const snapshot = sampleSnapshot();
    snapshot.convertibleRounds.push(convertibleRound('jkiss-2', 2, { valuationCap: null, conversionDeadline: '2027-06-01' }));
    snapshot.convertibleInvestments.push(convertibleInvestment('jkiss-2', 'aozora', 10_000_000));
    const views = buildRoundViews(snapshot, buildCapTable(snapshot), TODAY);
    expect(views[1].conversion?.basis).toBe('undetermined');
    expect(views[1].investments[0].estimatedShares).toBeNull();
    const totals = summarizeRounds(views);
    expect(totals.hasUndetermined).toBe(true);
    expect(totals.outstandingAmount).toBe(40_000_000);
    expect(totals.nextDeadline?.roundName).toBe(snapshot.convertibleRounds[1].name);
  });
});

describe('株式の異動への引き継ぎ', () => {
  it('転換の異動の初期値を作る', () => {
    const defaults = conversionTransactionDefaults(
      { name: '第1回 J-KISS 型新株予約権' },
      { stakeholderId: 'aozora', amount: 30_000_000, convertedShares: 1_049, convertedOn: '2026-10-30' },
    );
    expect(defaults).toEqual({
      stakeholderId: 'aozora',
      transactionType: 'conversion',
      transactionDate: '2026-10-30',
      shares: '1,049',
      amount: '30,000,000',
      notes: '第1回 J-KISS 型新株予約権の転換',
    });
  });

  it('同じ株主・同じ株式数・同じ日の転換の異動だけを一致とみなす', () => {
    const investment = { stakeholderId: 'aozora', convertedShares: 1_049, convertedOn: '2026-10-30' };
    const other = transaction('aozora', COMMON, '2026-10-30', 1_049);
    const match = transaction('aozora', COMMON, '2026-10-30', 1_049, { transactionType: 'conversion' });
    const otherDay = transaction('aozora', COMMON, '2026-10-31', 1_049, { transactionType: 'conversion' });
    expect(findConversionTransaction([other, otherDay], investment)).toBeNull();
    expect(findConversionTransaction([other, match], investment)).toBe(match);
  });
});
