// 株式・新株予約権まわりの台帳の型と選択肢。サーバ依存を持たない（API・画面・テストのどこからでも import できる）。
// 値の正本は DB の check 制約（supabase/migrations/20261111000000_schema.sql）。

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

export const optionLabel = (options: readonly Option[], value: string | null | undefined): string =>
  options.find((option) => option.value === value)?.label ?? value ?? '';

export const STAKEHOLDER_KINDS = [
  { value: 'individual', label: '個人' },
  { value: 'corporation', label: '法人' },
  { value: 'fund', label: '投資事業組合・ファンド' },
  { value: 'other', label: 'その他' },
] as const satisfies readonly Option[];
export type StakeholderKind = (typeof STAKEHOLDER_KINDS)[number]['value'];

export const STAKEHOLDER_RELATIONSHIPS = [
  { value: 'founder', label: '創業者' },
  { value: 'officer', label: '役員' },
  { value: 'employee', label: '従業員' },
  { value: 'investor', label: '投資家' },
  { value: 'advisor', label: '社外協力者' },
  { value: 'other', label: 'その他' },
] as const satisfies readonly Option[];
export type StakeholderRelationship = (typeof STAKEHOLDER_RELATIONSHIPS)[number]['value'];

export const SHARE_CLASS_KINDS = [
  { value: 'common', label: '普通株式' },
  { value: 'preferred', label: '優先株式' },
  { value: 'other', label: 'その他の種類株式' },
] as const satisfies readonly Option[];
export type ShareClassKind = (typeof SHARE_CLASS_KINDS)[number]['value'];

export const PARTICIPATION_TYPES = [
  { value: 'non_participating', label: '非参加型' },
  { value: 'participating', label: '参加型（上限なし）' },
  { value: 'capped_participating', label: '参加型（上限あり）' },
] as const satisfies readonly Option[];
export type ParticipationType = (typeof PARTICIPATION_TYPES)[number]['value'];

export const ANTI_DILUTION_TYPES = [
  { value: 'none', label: 'なし' },
  { value: 'broad_weighted_average', label: '加重平均（ブロードベース）' },
  { value: 'narrow_weighted_average', label: '加重平均（ナローベース）' },
  { value: 'full_ratchet', label: 'フルラチェット' },
] as const satisfies readonly Option[];
export type AntiDilutionType = (typeof ANTI_DILUTION_TYPES)[number]['value'];

export const ROUND_TYPES = [
  { value: 'founding', label: '設立' },
  { value: 'angel', label: 'エンジェル' },
  { value: 'seed', label: 'シード' },
  { value: 'pre_series_a', label: 'プレシリーズA' },
  { value: 'series_a', label: 'シリーズA' },
  { value: 'series_b', label: 'シリーズB' },
  { value: 'series_c', label: 'シリーズC' },
  { value: 'later', label: 'シリーズD 以降' },
  { value: 'bridge', label: 'ブリッジ' },
  { value: 'other', label: 'その他' },
] as const satisfies readonly Option[];
export type RoundType = (typeof ROUND_TYPES)[number]['value'];

export const ROUND_STATUSES = [
  { value: 'planned', label: '計画中' },
  { value: 'closed', label: '完了' },
] as const satisfies readonly Option[];
export type RoundStatus = (typeof ROUND_STATUSES)[number]['value'];

export const SHARE_TRANSACTION_TYPES = [
  { value: 'founding', label: '設立時発行' },
  { value: 'new_issue', label: '募集株式の発行（増資）' },
  { value: 'transfer', label: '株式譲渡' },
  { value: 'split', label: '株式分割・併合' },
  { value: 'exercise', label: '新株予約権の行使' },
  { value: 'conversion', label: '転換（J-KISS・種類株式）' },
  { value: 'acquisition', label: '自己株式の取得' },
  { value: 'cancellation', label: '消却' },
  { value: 'other', label: 'その他' },
] as const satisfies readonly Option[];
export type ShareTransactionType = (typeof SHARE_TRANSACTION_TYPES)[number]['value'];

/** 会社に資金が入る異動（払込総額に合計する）。譲渡は株主間の売買なので含めない。 */
export const CAPITAL_TRANSACTION_TYPES: readonly ShareTransactionType[] = ['founding', 'new_issue', 'exercise', 'conversion'];

export const CONVERTIBLE_INSTRUMENT_TYPES = [
  { value: 'jkiss', label: 'J-KISS 型新株予約権' },
  { value: 'convertible_bond', label: '転換社債型新株予約権付社債' },
  { value: 'other', label: 'その他' },
] as const satisfies readonly Option[];
export type ConvertibleInstrumentType = (typeof CONVERTIBLE_INSTRUMENT_TYPES)[number]['value'];

export const CAP_BASES = [
  { value: 'post_money', label: 'ポストマネー（J-KISS 2.0）' },
  { value: 'pre_money', label: 'プレマネー（J-KISS 1.x）' },
] as const satisfies readonly Option[];
export type CapBasis = (typeof CAP_BASES)[number]['value'];

export const CONVERTIBLE_STATUSES = [
  { value: 'outstanding', label: '未転換' },
  { value: 'converted', label: '転換済み' },
  { value: 'redeemed', label: '償還・消滅' },
] as const satisfies readonly Option[];
export type ConvertibleStatus = (typeof CONVERTIBLE_STATUSES)[number]['value'];

export const OPTION_PLAN_TYPES = [
  { value: 'tax_qualified', label: '税制適格ストックオプション' },
  { value: 'non_qualified', label: '税制非適格ストックオプション' },
  { value: 'paid', label: '有償ストックオプション' },
  { value: 'trust', label: '信託型ストックオプション' },
  { value: 'other', label: 'その他の新株予約権' },
] as const satisfies readonly Option[];
export type OptionPlanType = (typeof OPTION_PLAN_TYPES)[number]['value'];

export const VESTING_INTERVALS = [
  { value: 'monthly', label: '毎月' },
  { value: 'quarterly', label: '3 か月ごと' },
  { value: 'yearly', label: '1 年ごと' },
] as const satisfies readonly Option[];
export type VestingInterval = (typeof VESTING_INTERVALS)[number]['value'];

export const GRANT_ROLES = [
  { value: 'director', label: '当社取締役・執行役' },
  { value: 'employee', label: '当社従業員' },
  { value: 'subsidiary_director', label: '子会社取締役' },
  { value: 'subsidiary_employee', label: '子会社従業員' },
  { value: 'advisor', label: '社外協力者（社外高度人材を含む）' },
  { value: 'other', label: 'その他' },
] as const satisfies readonly Option[];
export type GrantRole = (typeof GRANT_ROLES)[number]['value'];

export const OPTION_EVENT_TYPES = [
  { value: 'exercise', label: '行使' },
  { value: 'forfeit', label: '失効・放棄' },
] as const satisfies readonly Option[];
export type OptionEventType = (typeof OPTION_EVENT_TYPES)[number]['value'];

// ---- 台帳の行（DB の列名どおり。numeric / bigint は API で number に直してから渡す） ----

export interface Stakeholder {
  id: string;
  name: string;
  nameKana: string | null;
  kind: StakeholderKind;
  relationship: StakeholderRelationship;
  postalCode: string | null;
  address: string;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
  notes: string;
}

export interface ShareClass {
  id: string;
  name: string;
  kind: ShareClassKind;
  seniority: number;
  originalIssuePrice: number | null;
  liquidationMultiple: number;
  participation: ParticipationType;
  participationCapMultiple: number | null;
  conversionRatio: number;
  hasVotingRights: boolean;
  antiDilution: AntiDilutionType;
  dividendPreference: string;
  authorizedShares: number | null;
  terms: string;
  sortOrder: number;
}

export interface FundingRound {
  id: string;
  name: string;
  roundType: RoundType;
  status: RoundStatus;
  shareClassId: string | null;
  closingDate: string | null;
  pricePerShare: number | null;
  preMoneyValuation: number | null;
  targetAmount: number | null;
  resolutionDate: string | null;
  registrationDate: string | null;
  capitalIncreaseAmount: number | null;
  notes: string;
}

export interface ShareTransaction {
  id: string;
  stakeholderId: string;
  shareClassId: string;
  roundId: string | null;
  groupId: string | null;
  transactionDate: string;
  transactionType: ShareTransactionType;
  /** 取得は正、譲渡・消却は負 */
  shares: number;
  pricePerShare: number | null;
  amount: number | null;
  capitalAmount: number | null;
  counterparty: string;
  notes: string;
}

export interface ConvertibleRound {
  id: string;
  roundNo: number;
  name: string;
  instrumentType: ConvertibleInstrumentType;
  issueDate: string | null;
  /** 評価上限額（円）。null はキャップなし */
  valuationCap: number | null;
  /** 評価上限額の基準 */
  capBasis: CapBasis;
  /** ディスカウント率（0.2 = 20%） */
  discountRate: number;
  qualifiedFinancingAmount: number | null;
  conversionDeadline: string | null;
  status: ConvertibleStatus;
  notes: string;
}

export interface ConvertibleInvestment {
  id: string;
  roundId: string;
  stakeholderId: string;
  amount: number;
  investmentDate: string | null;
  convertedShares: number | null;
  convertedOn: string | null;
  notes: string;
}

export interface OptionPlan {
  id: string;
  name: string;
  planType: OptionPlanType;
  shareClassId: string | null;
  resolutionDate: string | null;
  allotmentDate: string | null;
  totalUnits: number;
  sharesPerUnit: number;
  exercisePrice: number;
  issuePrice: number;
  fairValuePerShare: number | null;
  exercisePeriodStart: string | null;
  exercisePeriodEnd: string | null;
  vestingMonths: number | null;
  cliffMonths: number | null;
  vestingInterval: VestingInterval;
  exerciseConditions: string;
  registeredOn: string | null;
  notes: string;
}

export interface OptionGrant {
  id: string;
  planId: string;
  stakeholderId: string;
  holderRole: GrantRole;
  units: number;
  grantedOn: string | null;
  vestingStartOn: string | null;
  contractSignedOn: string | null;
  notes: string;
}

export interface OptionEvent {
  id: string;
  grantId: string;
  eventType: OptionEventType;
  eventDate: string;
  units: number;
  notes: string;
}

/** GET /api/equity が返す台帳一式 */
export interface EquitySnapshot {
  stakeholders: Stakeholder[];
  shareClasses: ShareClass[];
  fundingRounds: FundingRound[];
  shareTransactions: ShareTransaction[];
  convertibleRounds: ConvertibleRound[];
  convertibleInvestments: ConvertibleInvestment[];
  optionPlans: OptionPlan[];
  optionGrants: OptionGrant[];
  optionEvents: OptionEvent[];
}

export const emptySnapshot = (): EquitySnapshot => ({
  stakeholders: [],
  shareClasses: [],
  fundingRounds: [],
  shareTransactions: [],
  convertibleRounds: [],
  convertibleInvestments: [],
  optionPlans: [],
  optionGrants: [],
  optionEvents: [],
});
