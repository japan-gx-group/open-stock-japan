import { describe, expect, it } from 'vitest';
import type { FundingRound } from '@/lib/equity/types';
import { COMMON, SERIES_A, sampleSnapshot, shareClass, stakeholder, transaction } from '@/lib/equity/__tests__/fixture';
import { summarizeRounds, summarizeShareClasses } from '../roundSummary';

const round = (id: string, patch: Partial<FundingRound> = {}): FundingRound => ({
  id,
  name: 'シリーズA',
  roundType: 'series_a',
  status: 'closed',
  shareClassId: SERIES_A,
  closingDate: '2026-10-30',
  pricePerShare: 1_500,
  preMoneyValuation: 1_650_000_000,
  targetAmount: 150_000_000,
  resolutionDate: null,
  registrationDate: null,
  capitalIncreaseAmount: null,
  notes: '',
  ...patch,
});

const snapshotWithRound = (patch: Partial<FundingRound> = {}) => {
  const snapshot = sampleSnapshot();
  snapshot.stakeholders.push(stakeholder('mirai', 'みらいファンド', { kind: 'fund', relationship: 'investor' }));
  snapshot.shareClasses.push(shareClass(SERIES_A, 'A種優先株式', { kind: 'preferred', originalIssuePrice: 1_500, sortOrder: 1, authorizedShares: 50_000 }));
  snapshot.fundingRounds.push(round('round-a', patch));
  snapshot.shareTransactions.push(
    transaction('mirai', SERIES_A, '2026-10-30', 60_000, { transactionType: 'new_issue', roundId: 'round-a', pricePerShare: 1_500, amount: 90_000_000 }),
    transaction('aozora', SERIES_A, '2026-10-30', 40_000, { transactionType: 'new_issue', roundId: 'round-a', pricePerShare: 1_500 }),
  );
  return snapshot;
};

describe('summarizeRounds', () => {
  it('紐づく異動から払込額・株式数・ポストマネーを求める', () => {
    const [summary] = summarizeRounds(snapshotWithRound(), '2026-11-11');
    expect(summary.allotments.map((item) => [item.stakeholderName, item.amount])).toEqual([
      ['みらいファンド', 90_000_000],
      ['青空1号投資事業有限責任組合', 60_000_000],
    ]);
    expect(summary).toMatchObject({
      shareClassName: 'A種優先株式',
      sharesIssued: 100_000,
      amountRaised: 150_000_000,
      progress: 1,
      postMoney: 1_800_000_000,
      postMoneyIsPlanned: false,
    });
  });

  it('資本金の最低額と登録免許税の目安を返す', () => {
    const [summary] = summarizeRounds(snapshotWithRound(), '2026-11-11');
    // 払込 1.5 億円 → 資本金は最低 7,500 万円、登録免許税は 7,500 万円 × 0.7% = 525,000 円
    expect(summary).toMatchObject({ capitalBasis: 150_000_000, minimumCapital: 75_000_000, capitalIncrease: 75_000_000, registrationTax: 525_000 });
    const [all] = summarizeRounds(snapshotWithRound({ capitalIncreaseAmount: 150_000_000 }), '2026-11-11');
    expect(all).toMatchObject({ capitalIncrease: 150_000_000, registrationTax: 1_050_000 });
  });

  it('登記の期限は払込期日から 2 週間。過ぎていれば期限超過', () => {
    expect(summarizeRounds(snapshotWithRound(), '2026-11-11')[0].registration).toMatchObject({ state: 'pending', deadline: '2026-11-13', daysLeft: 2 });
    expect(summarizeRounds(snapshotWithRound(), '2026-11-14')[0].registration).toMatchObject({ state: 'overdue', daysLeft: -1 });
    expect(summarizeRounds(snapshotWithRound({ registrationDate: '2026-11-10' }), '2026-12-01')[0].registration).toMatchObject({
      state: 'registered',
      registeredLate: false,
    });
    expect(summarizeRounds(snapshotWithRound({ registrationDate: '2026-11-20' }), '2026-12-01')[0].registration.registeredLate).toBe(true);
  });

  it('計画中のラウンドは登記の対象外で、ポストマネーは予定額で出す', () => {
    const snapshot = sampleSnapshot();
    snapshot.fundingRounds.push(round('round-b', { status: 'planned', closingDate: null, shareClassId: null }));
    const [summary] = summarizeRounds(snapshot, '2026-11-11');
    expect(summary.registration.state).toBe('not_applicable');
    expect(summary).toMatchObject({ amountRaised: 0, progress: 0, postMoney: 1_800_000_000, postMoneyIsPlanned: true, shareClassName: '', capitalBasis: 150_000_000 });
    const [empty] = summarizeRounds({ ...snapshot, fundingRounds: [round('round-c', { status: 'planned', preMoneyValuation: null, targetAmount: null })] }, '2026-11-11');
    expect(empty).toMatchObject({ postMoney: null, progress: null, capitalBasis: null, minimumCapital: null, registrationTax: null });
  });
});

describe('summarizeShareClasses', () => {
  it('種類ごとの発行済株式数と発行可能種類株式総数の使用率を返す', () => {
    const summaries = summarizeShareClasses(snapshotWithRound());
    expect(summaries.map((item) => [item.shareClass.id, item.issuedShares, item.holderCount])).toEqual([
      [COMMON, 10_000, 2],
      [SERIES_A, 100_000, 2],
    ]);
    expect(summaries[0]).toMatchObject({ authorizedUsage: null, exceedsAuthorized: false });
    expect(summaries[1]).toMatchObject({ authorizedUsage: 2, exceedsAuthorized: true });
  });
});
