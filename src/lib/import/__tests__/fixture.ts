// テスト用の台帳の状態と読取りの結果（すべて架空）。
import type { ImportContext, ImportExtraction } from '../types';

export const ID = {
  founder: '10000000-0000-4000-8000-000000000001',
  fund: '10000000-0000-4000-8000-000000000002',
  corp: '10000000-0000-4000-8000-000000000003',
  common: '20000000-0000-4000-8000-000000000001',
  classA: '20000000-0000-4000-8000-000000000002',
  round: '30000000-0000-4000-8000-000000000001',
  jkiss: '40000000-0000-4000-8000-000000000001',
  plan: '50000000-0000-4000-8000-000000000001',
  fy3: '60000000-0000-4000-8000-000000000003',
  fy4: '60000000-0000-4000-8000-000000000004',
};

export const context = (overrides: Partial<ImportContext> = {}): ImportContext => ({
  stakeholders: [
    { id: ID.founder, label: '創業 太郎' },
    { id: ID.fund, label: '架空1号投資事業有限責任組合' },
    { id: ID.corp, label: '架空事業会社株式会社' },
  ],
  shareClasses: [
    { id: ID.common, label: '普通株式' },
    { id: ID.classA, label: 'A種優先株式' },
  ],
  fundingRounds: [{ id: ID.round, label: 'シリーズA' }],
  convertibleRounds: [{ id: ID.jkiss, label: '第1回 J-KISS 型新株予約権', roundNo: 1 }],
  optionPlans: [{ id: ID.plan, label: '第1回新株予約権', totalUnits: 1000 }],
  fiscalYears: [
    { id: ID.fy4, label: '第4期', startDate: '2026-04-01', endDate: '2027-03-31' },
    { id: ID.fy3, label: '第3期', startDate: '2025-04-01', endDate: '2026-03-31' },
  ],
  officers: [{ id: 'o1', name: '創業 太郎', position: 'representative_director', retiredOn: null }],
  meetings: [{ id: 'm1', title: '第19回 取締役会', heldOn: '2026-10-01', meetingType: 'board' }],
  financialReports: [{ id: 'f1', title: '第3期 決算', periodStart: '2025-04-01', periodEnd: '2026-03-31' }],
  shareTransactions: [
    { stakeholderId: ID.founder, shareClassId: ID.common, transactionDate: '2023-04-03', shares: 800_000 },
    { stakeholderId: ID.fund, shareClassId: ID.classA, transactionDate: '2025-06-30', shares: 2_000 },
  ],
  optionGrants: [{ planId: ID.plan, stakeholderId: ID.founder, units: 100 }],
  convertibleInvestments: [{ roundId: ID.jkiss, stakeholderId: ID.fund, amount: 10_000_000 }],
  company: {
    name: '架空テック株式会社',
    address: '東京都港区架空一丁目2番3号',
    capitalAmount: 76_000_000,
    authorizedShares: 10_000_000,
    hasAuditor: true,
    hasBoardOfDirectors: true,
    hasTransferRestriction: true,
    auditorLimitedToAccounting: false,
    fiscalYearStartMonth: '4',
    publicNoticeMethod: 'official_gazette',
  },
  canEditCompany: true,
  ...overrides,
});

/** 総数引受契約（登録済みのファンド・表記のゆれた法人・新しいファンド、新しい種類株式） */
export const investmentExtraction = (): ImportExtraction => ({
  documentKind: 'investment_agreement',
  summary: 'B種優先株式の総数引受契約',
  documentDate: '2026-11-25',
  warnings: [],
  groups: {
    stakeholders: [
      { name: '架空1号投資事業有限責任組合', kind: 'fund', relationship: 'investor', address: '東京都千代田区', nameKana: null, postalCode: null, contactPerson: null },
      { name: '（株）架空事業会社', kind: 'corporation', relationship: 'investor', address: '大阪府大阪市', nameKana: null, postalCode: null, contactPerson: null },
    ],
    shareClasses: [{ name: 'B種優先株式', kind: 'preferred', originalIssuePrice: 40000, liquidationMultiple: 1, participation: 'non_participating', hasVotingRights: true }],
    fundingRound: [
      { shareClassName: 'B種優先株式', name: 'シリーズB', roundType: 'series_b', pricePerShare: 40000, targetAmount: 100_000_000, capitalIncreaseAmount: 50_000_000, resolutionDate: '2026-11-20', closingDate: '2026-12-15' },
    ],
    shareTransactions: [
      { holderName: '架空1号投資事業有限責任組合', shareClassName: 'B種優先株式', transactionDate: '2026-12-15', shares: 1500, pricePerShare: 40000, amount: 60_000_000, capitalAmount: null },
      { holderName: '（株）架空事業会社', shareClassName: 'B種優先株式', transactionDate: '2026-12-15', shares: 500, pricePerShare: 40000, amount: 20_000_000, capitalAmount: null },
      { holderName: '架空みらい2号投資事業有限責任組合', shareClassName: 'B種優先株式', transactionDate: '2026-12-15', shares: 500, pricePerShare: 40000, amount: 20_000_000, capitalAmount: null },
    ],
  },
});
