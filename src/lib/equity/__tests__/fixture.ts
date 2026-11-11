// テスト用の台帳（すべて架空の会社・人物）。
import {
  emptySnapshot,
  type ConvertibleInvestment,
  type ConvertibleRound,
  type EquitySnapshot,
  type OptionEvent,
  type OptionGrant,
  type OptionPlan,
  type ShareClass,
  type ShareTransaction,
  type Stakeholder,
} from '../types';

export const stakeholder = (id: string, name: string, patch: Partial<Stakeholder> = {}): Stakeholder => ({
  id,
  name,
  nameKana: null,
  kind: 'individual',
  relationship: 'founder',
  postalCode: null,
  address: '東京都千代田区架空町1-1-1',
  email: null,
  phone: null,
  contactPerson: null,
  notes: '',
  ...patch,
});

export const shareClass = (id: string, name: string, patch: Partial<ShareClass> = {}): ShareClass => ({
  id,
  name,
  kind: 'common',
  seniority: 0,
  originalIssuePrice: null,
  liquidationMultiple: 1,
  participation: 'non_participating',
  participationCapMultiple: null,
  conversionRatio: 1,
  hasVotingRights: true,
  antiDilution: 'none',
  dividendPreference: '',
  authorizedShares: null,
  terms: '',
  sortOrder: 0,
  ...patch,
});

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${(sequence += 1)}`;

export const transaction = (
  stakeholderId: string,
  shareClassId: string,
  transactionDate: string,
  shares: number,
  patch: Partial<ShareTransaction> = {},
): ShareTransaction => ({
  id: nextId('tx'),
  stakeholderId,
  shareClassId,
  roundId: null,
  groupId: null,
  transactionDate,
  transactionType: 'new_issue',
  shares,
  pricePerShare: null,
  amount: null,
  capitalAmount: null,
  counterparty: '',
  notes: '',
  ...patch,
});

export const convertibleRound = (id: string, roundNo: number, patch: Partial<ConvertibleRound> = {}): ConvertibleRound => ({
  id,
  roundNo,
  name: `第${roundNo}回 J-KISS 型新株予約権`,
  instrumentType: 'jkiss',
  issueDate: null,
  valuationCap: 300_000_000,
  capBasis: 'pre_money',
  discountRate: 0.2,
  qualifiedFinancingAmount: 100_000_000,
  conversionDeadline: null,
  status: 'outstanding',
  notes: '',
  ...patch,
});

export const convertibleInvestment = (
  roundId: string,
  stakeholderId: string,
  amount: number,
  patch: Partial<ConvertibleInvestment> = {},
): ConvertibleInvestment => ({
  id: nextId('cv'),
  roundId,
  stakeholderId,
  amount,
  investmentDate: null,
  convertedShares: null,
  convertedOn: null,
  notes: '',
  ...patch,
});

export const optionPlan = (id: string, patch: Partial<OptionPlan> = {}): OptionPlan => ({
  id,
  name: '第1回新株予約権',
  planType: 'tax_qualified',
  shareClassId: null,
  resolutionDate: '2025-06-20',
  allotmentDate: '2025-07-01',
  totalUnits: 1000,
  sharesPerUnit: 1,
  exercisePrice: 500,
  issuePrice: 0,
  fairValuePerShare: 500,
  exercisePeriodStart: '2027-07-02',
  exercisePeriodEnd: '2035-06-19',
  vestingMonths: 48,
  cliffMonths: 12,
  vestingInterval: 'monthly',
  exerciseConditions: '',
  registeredOn: null,
  notes: '',
  ...patch,
});

export const optionGrant = (id: string, planId: string, stakeholderId: string, units: number, patch: Partial<OptionGrant> = {}): OptionGrant => ({
  id,
  planId,
  stakeholderId,
  holderRole: 'employee',
  units,
  grantedOn: '2025-07-01',
  vestingStartOn: null,
  contractSignedOn: '2025-07-01',
  notes: '',
  ...patch,
});

export const optionEvent = (grantId: string, eventType: OptionEvent['eventType'], eventDate: string, units: number): OptionEvent => ({
  id: nextId('ev'),
  grantId,
  eventType,
  eventDate,
  units,
  notes: '',
});

export const COMMON = 'class-common';
export const SERIES_A = 'class-a';

/**
 * 架空の「株式会社サンプル」:
 *   設立: 山田 8,000 株・佐藤 2,000 株（普通株式、1 株 100 円）
 *   J-KISS: 第1回（キャップ 3 億円・20%）に 青空ファンド 3,000 万円
 *   SO: 第1回 1,000 個（1 個 1 株）のうち 鈴木 400 個・田中 100 個
 */
export const sampleSnapshot = (): EquitySnapshot => ({
  ...emptySnapshot(),
  stakeholders: [
    stakeholder('yamada', '山田 太郎'),
    stakeholder('sato', '佐藤 花子'),
    stakeholder('aozora', '青空1号投資事業有限責任組合', { kind: 'fund', relationship: 'investor' }),
    stakeholder('suzuki', '鈴木 一郎', { relationship: 'employee' }),
    stakeholder('tanaka', '田中 次郎', { relationship: 'employee' }),
  ],
  shareClasses: [shareClass(COMMON, '普通株式')],
  shareTransactions: [
    transaction('yamada', COMMON, '2024-04-01', 8000, { transactionType: 'founding', pricePerShare: 100, amount: 800_000 }),
    transaction('sato', COMMON, '2024-04-01', 2000, { transactionType: 'founding', pricePerShare: 100, amount: 200_000 }),
  ],
  convertibleRounds: [convertibleRound('jkiss-1', 1, { issueDate: '2025-01-15' })],
  convertibleInvestments: [convertibleInvestment('jkiss-1', 'aozora', 30_000_000, { investmentDate: '2025-01-15' })],
  optionPlans: [optionPlan('plan-1')],
  optionGrants: [optionGrant('grant-suzuki', 'plan-1', 'suzuki', 400), optionGrant('grant-tanaka', 'plan-1', 'tanaka', 100)],
});
