import { describe, expect, it } from 'vitest';
import { emptySnapshot, type EquitySnapshot } from '@/lib/equity/types';
import { shareClass, stakeholder, transaction } from '@/lib/equity/__tests__/fixture';
import {
  buildOwnHoldings,
  isDocumentVisibleToShareholder,
  publishedReports,
  publishedUpdates,
  toPortalDocument,
  toPortalFinancialReport,
  toUpdateSummary,
  visibleDocuments,
  withoutUnpublishedParents,
} from '../visibility';

describe('お知らせ', () => {
  const rows = [
    { id: 'u1', title: '下書き', category: 'news', status: 'draft', body: '秘密', publishedAt: null, createdByUserId: 'x', meetingId: 'm' },
    { id: 'u2', title: '古い', category: 'news', status: 'published', body: 'a', publishedAt: '2026-01-01T00:00:00Z', createdByUserId: 'x' },
    { id: 'u3', title: '新しい', category: 'financial', status: 'published', body: 'b', publishedAt: '2026-06-01T00:00:00Z' },
  ];
  it('公開中だけを新しい順に返し、下書きは含めない', () => {
    const result = publishedUpdates(rows);
    expect(result.map((row) => row.id)).toEqual(['u3', 'u2']);
    expect(JSON.stringify(result)).not.toContain('秘密');
  });
  it('社内用の列（作成者・会議の id）を写さない', () => {
    expect(Object.keys(publishedUpdates(rows)[0]).sort()).toEqual(['body', 'category', 'id', 'publishedAt', 'title']);
    expect(Object.keys(toUpdateSummary(publishedUpdates(rows)[0])).sort()).toEqual(['category', 'id', 'publishedAt', 'title']);
  });
});

describe('決算情報', () => {
  const base = {
    title: '第3期', periodType: 'annual', periodStart: '2025-04-01', periodEnd: '2026-03-31', revenue: '132000000', netIncome: -1,
    status: 'approved', highlights: 'h', approvedMeetingId: 'meeting-1', fiscalYearId: 'fy-1', createdAt: 'c', updatedAt: 'u',
  };
  it('株主に公開したものだけを期間の新しい順に返す', () => {
    const result = publishedReports([
      { ...base, id: 'r1', isPublishedToShareholders: false },
      { ...base, id: 'r2', isPublishedToShareholders: true, periodEnd: '2025-03-31' },
      { ...base, id: 'r3', isPublishedToShareholders: true },
      { ...base, id: 'r4', isPublishedToShareholders: 'true' },
    ]);
    expect(result.map((row) => row.id)).toEqual(['r3', 'r2']);
  });
  it('株主向けの項目だけを写す（会議・事業年度の id や状態の生の値は出さない）', () => {
    const report = toPortalFinancialReport({ ...base, id: 'r1', isPublishedToShareholders: true });
    expect(report.revenue).toBe(132000000);
    expect(report.netIncome).toBe(-1);
    expect(report.grossProfit).toBeNull();
    expect(report.isApproved).toBe(true);
    const keys = Object.keys(report);
    for (const hidden of ['approvedMeetingId', 'fiscalYearId', 'status', 'createdAt', 'updatedAt', 'isPublishedToShareholders']) {
      expect(keys).not.toContain(hidden);
    }
  });
});

describe('文書', () => {
  const shared = new Set(['d3']);
  it('全株主の文書と、自分が指定された文書だけが見える', () => {
    expect(isDocumentVisibleToShareholder({ id: 'd1', visibility: 'internal' }, shared)).toBe(false);
    expect(isDocumentVisibleToShareholder({ id: 'd2', visibility: 'shareholders' }, shared)).toBe(true);
    expect(isDocumentVisibleToShareholder({ id: 'd3', visibility: 'restricted' }, shared)).toBe(true);
    expect(isDocumentVisibleToShareholder({ id: 'd4', visibility: 'restricted' }, shared)).toBe(false);
  });
  it('社内のみの文書は、公開先の行が残っていても見えない', () => {
    expect(isDocumentVisibleToShareholder({ id: 'd3', visibility: 'internal' }, shared)).toBe(false);
  });
  it('公開範囲が不明な値のものは見えない', () => {
    expect(isDocumentVisibleToShareholder({ id: 'd3', visibility: undefined }, shared)).toBe(false);
    expect(isDocumentVisibleToShareholder({ id: 'd3', visibility: 'public' }, shared)).toBe(false);
  });
  it('社内の人のプレビュー（紐づく権利者なし）では全株主の文書だけになる', () => {
    const rows = [
      { id: 'd1', visibility: 'internal' },
      { id: 'd2', visibility: 'shareholders' },
      { id: 'd3', visibility: 'restricted' },
    ];
    expect(visibleDocuments(rows, new Set()).map((row) => row.id)).toEqual(['d2']);
  });
  it('保存場所・ハッシュ・登録者・公開範囲を写さない', () => {
    const document = toPortalDocument({
      id: 'd2', title: 't', category: 'report', description: '', documentDate: null, fileName: 'a.pdf', mimeType: 'application/pdf',
      sizeBytes: '10', visibility: 'shareholders', storagePath: 'org/x.pdf', sha256: 'abc', uploadedByUserId: 'user', organizationId: 'org',
      entityType: 'meeting', entityId: 'm1', createdAt: 'c',
    });
    expect(document.sizeBytes).toBe(10);
    expect(document.entityType).toBeNull();
    expect(document.entityId).toBeNull();
    for (const hidden of ['storagePath', 'sha256', 'uploadedByUserId', 'organizationId', 'visibility']) {
      expect(Object.keys(document)).not.toContain(hidden);
    }
  });
  it('公開されていないお知らせ・決算に付いた文書は出さない', () => {
    const documents = [
      toPortalDocument({ id: 'a', entityType: 'shareholder_update', entityId: 'u-pub' }),
      toPortalDocument({ id: 'b', entityType: 'shareholder_update', entityId: 'u-draft' }),
      toPortalDocument({ id: 'c', entityType: 'financial_report', entityId: 'r-hidden' }),
      toPortalDocument({ id: 'd', entityType: 'financial_report', entityId: 'r-pub' }),
      toPortalDocument({ id: 'e' }),
    ];
    expect(withoutUnpublishedParents(documents, new Set(['u-pub']), new Set(['r-pub'])).map((row) => row.id)).toEqual(['a', 'd', 'e']);
  });
});

describe('自分の保有状況', () => {
  const snapshot: EquitySnapshot = {
    ...emptySnapshot(),
    stakeholders: [
      stakeholder('s1', '架空 太郎', { email: 'taro@example.com', address: '東京都架空区1' }),
      stakeholder('s2', '架空 花子', { email: 'hanako@example.com', address: '大阪府架空市2', phone: '090-0000-0000' }),
    ],
    shareClasses: [shareClass('c1', '普通株式'), shareClass('c2', 'A種優先株式', { kind: 'preferred', sortOrder: 1 })],
    shareTransactions: [
      transaction('s1', 'c1', '2023-04-01', 700),
      transaction('s2', 'c1', '2023-04-01', 200),
      transaction('s2', 'c2', '2025-10-30', 100),
    ],
    optionPlans: [
      {
        id: 'p1', name: '第1回新株予約権', planType: 'tax_qualified', shareClassId: 'c1', resolutionDate: null, allotmentDate: '2024-01-01',
        totalUnits: 100, sharesPerUnit: 1, exercisePrice: 500, issuePrice: 0, fairValuePerShare: null,
        exercisePeriodStart: '2026-01-02', exercisePeriodEnd: '2034-01-01', vestingMonths: 48, cliffMonths: 12, vestingInterval: 'monthly',
        exerciseConditions: '在籍していること', registeredOn: null, notes: '社内メモ',
      },
    ],
    optionGrants: [
      { id: 'g1', planId: 'p1', stakeholderId: 's2', holderRole: 'employee', units: 48, grantedOn: '2024-01-01', vestingStartOn: '2024-01-01', contractSignedOn: null, notes: '花子の割当メモ' },
      { id: 'g2', planId: 'p1', stakeholderId: 's1', holderRole: 'director', units: 20, grantedOn: '2024-01-01', vestingStartOn: null, contractSignedOn: null, notes: '' },
    ],
    optionEvents: [
      { id: 'e1', grantId: 'g1', eventType: 'exercise', eventDate: '2026-02-01', units: 5, notes: '' },
      { id: 'e2', grantId: 'g1', eventType: 'forfeit', eventDate: '2026-03-01', units: 3, notes: '' },
      { id: 'e3', grantId: 'g2', eventType: 'exercise', eventDate: '2026-02-01', units: 7, notes: '' },
    ],
    convertibleRounds: [
      {
        id: 'r1', roundNo: 1, name: '第1回 J-KISS', instrumentType: 'jkiss', issueDate: '2024-06-01', valuationCap: 300_000_000, capBasis: 'post_money',
        discountRate: 0.2, qualifiedFinancingAmount: null, conversionDeadline: '2026-06-01', status: 'outstanding', notes: '',
      },
    ],
    convertibleInvestments: [
      { id: 'i1', roundId: 'r1', stakeholderId: 's2', amount: 5_000_000, investmentDate: '2024-06-01', convertedShares: null, convertedOn: null, notes: '' },
      { id: 'i2', roundId: 'r1', stakeholderId: 's1', amount: 9_000_000, investmentDate: '2024-06-02', convertedShares: null, convertedOn: null, notes: '' },
    ],
  };

  it('自分の株式・割合と、発行済株式総数を返す', () => {
    const holdings = buildOwnHoldings(snapshot, 's2', '2026-01-01');
    expect(holdings.linked).toBe(true);
    expect(holdings.holderName).toBe('架空 花子');
    expect(holdings.totalIssuedShares).toBe(1000);
    expect(holdings.ownShares).toBe(300);
    expect(holdings.ownRatio).toBeCloseTo(0.3);
    expect(holdings.shares).toEqual([
      { shareClassName: '普通株式', shares: 200, firstAcquiredOn: '2023-04-01', lastAcquiredOn: '2023-04-01', ratio: 0.2 },
      { shareClassName: 'A種優先株式', shares: 100, firstAcquiredOn: '2025-10-30', lastAcquiredOn: '2025-10-30', ratio: 0.1 },
    ]);
  });

  it('自分の新株予約権の確定・行使・失効・残りを計算する', () => {
    // 2026-01-01 時点: 開始から 24 か月 → 48 個のうち 24 個が確定。行使期間は翌日から
    const before = buildOwnHoldings(snapshot, 's2', '2026-01-01').optionGrants;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      planName: '第1回新株予約権', units: 48, vestedUnits: 24, unvestedUnits: 24, exercisedUnits: 5, forfeitedUnits: 3,
      remainingUnits: 40, exercisableUnits: 0, exercisePrice: 500, exercisePeriodState: 'before', exercisePeriodStart: '2026-01-02',
    });
    const open = buildOwnHoldings(snapshot, 's2', '2026-07-01').optionGrants[0];
    expect(open.exercisePeriodState).toBe('open');
    expect(open.vestedUnits).toBe(30);
    expect(open.exercisableUnits).toBe(25);
  });

  it('自分の転換型の投資だけを返す', () => {
    const holdings = buildOwnHoldings(snapshot, 's2', '2026-01-01');
    expect(holdings.convertibles).toEqual([
      {
        roundName: '第1回 J-KISS', instrumentType: 'jkiss', status: 'outstanding', amount: 5_000_000, investmentDate: '2024-06-01',
        valuationCap: 300_000_000, discountRate: 0.2, conversionDeadline: '2026-06-01', convertedShares: null, convertedOn: null,
      },
    ]);
  });

  it('ほかの権利者の氏名・連絡先・持株・割当・投資額・社内メモを含まない', () => {
    const json = JSON.stringify(buildOwnHoldings(snapshot, 's2', '2026-01-01'));
    for (const leaked of ['架空 太郎', 'taro@example.com', '東京都架空区1', '700', '9000000', 's1', 'g2', '社内メモ', '花子の割当メモ', 'hanako@example.com', '大阪府架空市2', '090-0000-0000']) {
      expect(json).not.toContain(leaked);
    }
  });

  it('紐づく権利者が無い（社内のプレビュー）・見つからないときは空で、全社の数字も返さない', () => {
    for (const id of [null, 'unknown']) {
      const holdings = buildOwnHoldings(snapshot, id, '2026-01-01');
      expect(holdings).toEqual({
        linked: false, holderName: null, asOf: '2026-01-01', totalIssuedShares: 0, ownShares: 0, ownRatio: 0, shares: [], optionGrants: [], convertibles: [],
      });
    }
  });

  it('株式を持たない権利者（新株予約権だけ）は株式が空で、発行済株式総数は返る', () => {
    const only = { ...snapshot, shareTransactions: [transaction('s1', 'c1', '2023-04-01', 700)] };
    const holdings = buildOwnHoldings(only, 's2', '2026-01-01');
    expect(holdings.shares).toEqual([]);
    expect(holdings.ownRatio).toBe(0);
    expect(holdings.totalIssuedShares).toBe(700);
    expect(holdings.optionGrants).toHaveLength(1);
  });
});
