// リソース定義（業務テーブルごとの項目・検証・表示名）。サーバ依存なし。
// 列の正本は supabase/migrations/20261111000000_schema.sql。項目を足すときは列も足すこと。

import {
  ANTI_DILUTION_TYPES,
  CAP_BASES,
  CONVERTIBLE_INSTRUMENT_TYPES,
  CONVERTIBLE_STATUSES,
  GRANT_ROLES,
  OPTION_EVENT_TYPES,
  OPTION_PLAN_TYPES,
  PARTICIPATION_TYPES,
  ROUND_STATUSES,
  ROUND_TYPES,
  SHARE_CLASS_KINDS,
  SHARE_TRANSACTION_TYPES,
  STAKEHOLDER_KINDS,
  STAKEHOLDER_RELATIONSHIPS,
  VESTING_INTERVALS,
  type Option,
} from '@/lib/equity/types';
import type { FieldDef, ResourceDef, ResourceValues } from './fields';

// ---- 株式以外の選択肢 ----

export const OFFICER_POSITIONS = [
  { value: 'representative_director', label: '代表取締役' },
  { value: 'director', label: '取締役' },
  { value: 'auditor', label: '監査役' },
  { value: 'accounting_advisor', label: '会計参与' },
  { value: 'executive_officer', label: '執行役員' },
  { value: 'other', label: 'その他' },
] as const satisfies readonly Option[];

export const MEETING_TYPES = [
  { value: 'agm', label: '定時株主総会' },
  { value: 'egm', label: '臨時株主総会' },
  { value: 'class_meeting', label: '種類株主総会' },
  { value: 'board', label: '取締役会' },
] as const satisfies readonly Option[];
export type MeetingType = (typeof MEETING_TYPES)[number]['value'];

export const MEETING_FORMATS = [
  { value: 'in_person', label: '会場で開催' },
  { value: 'online', label: 'オンラインで開催' },
  { value: 'hybrid', label: '会場とオンラインの併用' },
  { value: 'written_resolution', label: '書面決議（みなし決議）' },
] as const satisfies readonly Option[];

export const MEETING_STATUSES = [
  { value: 'planning', label: '準備中' },
  { value: 'noticed', label: '招集通知済み' },
  { value: 'held', label: '開催済み' },
  { value: 'closed', label: '議事録確定' },
] as const satisfies readonly Option[];

export const AGENDA_ITEM_TYPES = [
  { value: 'resolution', label: '決議事項' },
  { value: 'report', label: '報告事項' },
] as const satisfies readonly Option[];

export const RESOLUTION_TYPES = [
  { value: 'ordinary', label: '普通決議' },
  { value: 'special', label: '特別決議' },
  { value: 'extraordinary_309_3', label: '特殊決議（309条3項）' },
  { value: 'extraordinary_309_4', label: '特殊決議（309条4項）' },
  { value: 'unanimous', label: '総株主の同意' },
  { value: 'board', label: '取締役会決議' },
] as const satisfies readonly Option[];

export const AGENDA_RESULTS = [
  { value: 'pending', label: '未決' },
  { value: 'approved', label: '可決' },
  { value: 'rejected', label: '否決' },
  { value: 'withdrawn', label: '撤回' },
  { value: 'reported', label: '報告済み' },
] as const satisfies readonly Option[];

export const MEETING_RESPONSES = [
  { value: 'no_response', label: '未回答' },
  { value: 'attending', label: '出席' },
  { value: 'proxy', label: '委任状' },
  { value: 'written_vote', label: '書面による議決権行使' },
  { value: 'consent', label: '同意（書面決議）' },
  { value: 'dissent', label: '不同意・異議' },
  { value: 'absent', label: '欠席' },
] as const satisfies readonly Option[];

export const FINANCIAL_PERIOD_TYPES = [
  { value: 'annual', label: '通期' },
  { value: 'half', label: '半期' },
  { value: 'quarterly', label: '四半期' },
  { value: 'monthly', label: '月次' },
] as const satisfies readonly Option[];

export const FINANCIAL_STATUSES = [
  { value: 'draft', label: '作成中' },
  { value: 'approved', label: '承認済み' },
] as const satisfies readonly Option[];

export const DOCUMENT_CATEGORIES = [
  { value: 'articles', label: '定款' },
  { value: 'registry', label: '登記事項証明書' },
  { value: 'shareholder_agreement', label: '株主間契約' },
  { value: 'investment_agreement', label: '投資契約・総数引受契約' },
  { value: 'share_transfer', label: '株式譲渡契約・譲渡承認' },
  { value: 'stock_option', label: '新株予約権（発行要項・割当契約）' },
  { value: 'convertible', label: 'J-KISS・転換型証券' },
  { value: 'meeting', label: '株主総会・取締役会' },
  { value: 'financial', label: '決算書・計算書類' },
  { value: 'tax', label: '税務' },
  { value: 'report', label: '株主向けレポート' },
  { value: 'other', label: 'その他' },
] as const satisfies readonly Option[];

export const DOCUMENT_VISIBILITIES = [
  { value: 'internal', label: '社内のみ' },
  { value: 'shareholders', label: '全株主に公開' },
  { value: 'restricted', label: '指定した株主に公開' },
] as const satisfies readonly Option[];

export const UPDATE_CATEGORIES = [
  { value: 'news', label: 'お知らせ' },
  { value: 'monthly_report', label: '月次レポート' },
  { value: 'financial', label: '決算' },
  { value: 'meeting_notice', label: '株主総会' },
  { value: 'other', label: 'その他' },
] as const satisfies readonly Option[];

export const UPDATE_STATUSES = [
  { value: 'draft', label: '下書き' },
  { value: 'published', label: '公開中' },
] as const satisfies readonly Option[];

// 文書テンプレートの種類。種類ごとの差し込み項目・記載する事項・AI への指示は src/features/templates/services/kinds.ts。
// 足すときは、マイグレーションの document_templates_kind_check にも足すこと。
export const TEMPLATE_KINDS = [
  { value: 'shareholder_notice', label: '株主総会の招集通知' },
  { value: 'shareholder_minutes', label: '株主総会議事録' },
  { value: 'shareholder_written_proposal', label: '株主総会の書面決議の提案書・同意書' },
  { value: 'shareholder_written_minutes', label: '株主総会の書面決議の議事録' },
  { value: 'shareholder_proxy', label: '株主総会の委任状' },
  { value: 'shareholder_waiver', label: '株主総会の招集手続の省略の同意書' },
  { value: 'board_notice', label: '取締役会の招集通知' },
  { value: 'board_minutes', label: '取締役会議事録' },
  { value: 'board_written_proposal', label: '取締役会の書面決議の提案書・同意書' },
  { value: 'board_written_minutes', label: '取締役会の書面決議の議事録' },
  { value: 'convertible_terms', label: 'J-KISS の条件のまとめ（記入表）' },
  { value: 'convertible_proposal', label: 'J-KISS の発行の議案' },
  { value: 'convertible_payment_notice', label: 'J-KISS の払込みの案内' },
  { value: 'convertible_contract', label: '契約書（手元のひな形から）' },
  { value: 'other', label: 'その他の文書' },
] as const satisfies readonly Option[];
export type TemplateKindId = (typeof TEMPLATE_KINDS)[number]['value'];

export const TEMPLATE_STATUSES = [
  { value: 'draft', label: '確認中' },
  { value: 'reviewed', label: '確認済み' },
] as const satisfies readonly Option[];

// ---- 共通の項目 ----

const notes = (label = 'メモ'): FieldDef => ({ key: 'notes', label, type: 'textarea', maxLength: 4000, width: 'full' });
const text = (values: ResourceValues, key: string): string => (typeof values[key] === 'string' ? (values[key] as string) : '');
const num = (values: ResourceValues, key: string): number | null => (typeof values[key] === 'number' ? (values[key] as number) : null);

const dateOrder = (values: ResourceValues, startKey: string, endKey: string, message: string): Record<string, string> | null => {
  const start = text(values, startKey);
  const end = text(values, endKey);
  return start && end && end < start ? { [endKey]: message } : null;
};

// ---- 定義 ----

const stakeholders: ResourceDef = {
  name: 'stakeholders',
  table: 'stakeholders',
  label: '株主・権利者',
  formNote: '氏名（名称）と住所は株主名簿・新株予約権原簿の記載事項です（会社法121条・249条）。登記簿や本人確認書類の表記に合わせて入力してください。',
  fields: [
    { key: 'name', label: '氏名・名称', type: 'text', required: true, maxLength: 200, aiHint: '個人は氏名、法人は商号、ファンドは組合の正式名称' },
    { key: 'nameKana', label: 'フリガナ', type: 'text', maxLength: 200, nullable: true },
    { key: 'kind', label: '区分', type: 'select', options: STAKEHOLDER_KINDS, required: true, defaultValue: 'individual' },
    { key: 'relationship', label: '会社との関係', type: 'select', options: STAKEHOLDER_RELATIONSHIPS, required: true, defaultValue: 'investor' },
    { key: 'postalCode', label: '郵便番号', type: 'text', maxLength: 8, nullable: true, placeholder: '100-0001' },
    { key: 'address', label: '住所', type: 'text', maxLength: 500, width: 'full', help: '株主名簿の記載事項です' },
    { key: 'email', label: 'メールアドレス', type: 'email', help: '招集通知・お知らせの送付先、株主ポータルへの招待に使います' },
    { key: 'phone', label: '電話番号', type: 'text', maxLength: 20, nullable: true },
    { key: 'contactPerson', label: '担当者', type: 'text', maxLength: 100, nullable: true, help: '法人・ファンドの窓口の方' },
    notes(),
  ],
  orderBy: [{ column: 'createdAt', ascending: true }],
  labelOf: (row) => text(row, 'name'),
};

const officers: ResourceDef = {
  name: 'officers',
  table: 'officers',
  label: '役員',
  formNote: '就任・退任・重任は、変更の日から 2 週間以内に登記が必要です（会社法915条1項）。',
  fields: [
    { key: 'name', label: '氏名', type: 'text', required: true, maxLength: 100 },
    { key: 'nameKana', label: 'フリガナ', type: 'text', maxLength: 100, nullable: true },
    { key: 'position', label: '役職', type: 'select', options: OFFICER_POSITIONS, required: true, defaultValue: 'director' },
    { key: 'isOutside', label: '社外役員', type: 'boolean' },
    { key: 'stakeholderId', label: '株主・権利者としての登録', type: 'ref', ref: 'stakeholders', aiSkip: true, help: '同じ人が株主・新株予約権者でもある場合に選びます' },
    { key: 'appointedOn', label: '就任日（直近の選任日）', type: 'date' },
    { key: 'termExpiresOn', label: '任期満了の予定日', type: 'date', help: '空欄なら、就任日・定款の任期・事業年度から自動で計算します' },
    { key: 'retiredOn', label: '退任日', type: 'date' },
    { key: 'registeredOn', label: '登記した日', type: 'date' },
    notes(),
  ],
  orderBy: [
    { column: 'retiredOn', ascending: true },
    { column: 'appointedOn', ascending: true },
  ],
  labelOf: (row) => text(row, 'name'),
  validate: (values) => dateOrder(values, 'appointedOn', 'retiredOn', '退任日は就任日以降にしてください'),
};

const shareClasses: ResourceDef = {
  name: 'share-classes',
  table: 'share_classes',
  label: '株式の種類',
  formNote: '種類株式の内容は定款に定め、登記が必要です（会社法108条・911条3項7号）。ここには資本政策の計算に使う主な条件を入力します。',
  fields: [
    { key: 'name', label: '種類の名称', type: 'text', required: true, maxLength: 100, placeholder: 'A種優先株式' },
    { key: 'kind', label: '区分', type: 'select', options: SHARE_CLASS_KINDS, required: true, defaultValue: 'preferred' },
    { key: 'originalIssuePrice', label: '当初の払込金額（1 株あたり）', type: 'decimal', min: 0, help: '残余財産の優先分配額の基準になります' },
    { key: 'authorizedShares', label: '発行可能種類株式総数', type: 'integer', min: 1 },
    { key: 'liquidationMultiple', label: '残余財産の優先分配の倍率', type: 'decimal', min: 0, max: 100, required: true, defaultValue: '1', help: '1 倍なら払込金額と同額を優先して受け取ります' },
    { key: 'participation', label: '参加型・非参加型', type: 'select', options: PARTICIPATION_TYPES, required: true, defaultValue: 'non_participating' },
    { key: 'participationCapMultiple', label: '参加の上限の倍率', type: 'decimal', min: 0, max: 100, help: '上限つき参加型のときだけ入力します（優先分配と合わせた上限）' },
    { key: 'seniority', label: '優先順位', type: 'integer', min: 0, max: 100, required: true, defaultValue: '0', help: '数字が大きいほど先に分配を受けます。普通株式は 0' },
    { key: 'conversionRatio', label: '普通株式への転換比率', type: 'decimal', min: 0.00000001, max: 1_000_000, required: true, defaultValue: '1', help: '1 株あたり普通株式何株に転換するか' },
    { key: 'antiDilution', label: '希薄化防止条項', type: 'select', options: ANTI_DILUTION_TYPES, required: true, defaultValue: 'none' },
    { key: 'hasVotingRights', label: '株主総会の議決権がある', type: 'boolean', defaultValue: true },
    { key: 'sortOrder', label: '表示順', type: 'integer', min: 0, max: 10_000, required: true, defaultValue: '0', aiSkip: true },
    { key: 'dividendPreference', label: '優先配当', type: 'text', maxLength: 500, width: 'full', placeholder: '1 株あたり払込金額の 8%（非累積・非参加）' },
    { key: 'terms', label: 'その他の内容（取得請求権・取得条項・拒否権など）', type: 'textarea', maxLength: 8000, width: 'full' },
  ],
  orderBy: [
    { column: 'sortOrder', ascending: true },
    { column: 'createdAt', ascending: true },
  ],
  labelOf: (row) => text(row, 'name'),
  validate: (values) =>
    values.participation === 'capped_participating' && num(values, 'participationCapMultiple') == null
      ? { participationCapMultiple: '上限つき参加型では上限の倍率を入力してください' }
      : null,
};

const fundingRounds: ResourceDef = {
  name: 'funding-rounds',
  table: 'funding_rounds',
  label: '資金調達ラウンド',
  formNote: '非公開会社の募集株式の発行は、株主総会の特別決議で募集事項を決めます（会社法199条2項・309条2項5号）。払込みから 2 週間以内に登記が必要です。',
  fields: [
    { key: 'name', label: 'ラウンド名', type: 'text', required: true, maxLength: 100, placeholder: 'シリーズA' },
    { key: 'roundType', label: '種類', type: 'select', options: ROUND_TYPES, required: true, defaultValue: 'seed' },
    { key: 'status', label: '状態', type: 'select', options: ROUND_STATUSES, required: true, defaultValue: 'planned' },
    { key: 'shareClassId', label: '発行する株式の種類', type: 'ref', ref: 'share-classes' },
    { key: 'pricePerShare', label: '1 株あたりの払込金額', type: 'decimal', min: 0 },
    { key: 'preMoneyValuation', label: 'プレマネー評価額', type: 'yen', min: 0, placeholder: '5億' },
    { key: 'targetAmount', label: '調達額（予定または実績）', type: 'yen', min: 0, placeholder: '1億' },
    { key: 'capitalIncreaseAmount', label: '資本金に組み入れる額', type: 'yen', min: 0, help: '払込金額の 2 分の 1 以上（会社法445条）。残りは資本準備金' },
    { key: 'resolutionDate', label: '株主総会の決議日', type: 'date' },
    { key: 'closingDate', label: '払込期日（クロージング日）', type: 'date' },
    { key: 'registrationDate', label: '登記した日', type: 'date' },
    notes(),
  ],
  orderBy: [
    { column: 'closingDate', ascending: true },
    { column: 'createdAt', ascending: true },
  ],
  labelOf: (row) => text(row, 'name'),
  validate: (values) => {
    const target = num(values, 'targetAmount');
    const capital = num(values, 'capitalIncreaseAmount');
    if (target != null && capital != null && capital * 2 < target) {
      return { capitalIncreaseAmount: '資本金に組み入れる額は、払込金額の 2 分の 1 以上にしてください（会社法445条2項）' };
    }
    if (target != null && capital != null && capital > target) {
      return { capitalIncreaseAmount: '資本金に組み入れる額は調達額以下にしてください' };
    }
    return null;
  },
};

const shareTransactions: ResourceDef = {
  name: 'share-transactions',
  table: 'share_transactions',
  label: '株式の異動',
  formNote: '株式数は、取得を正の数、減少（消却・自己株式の取得への譲渡など）を負の数で入力します。株主間の譲渡は「株式譲渡を記録」から入力すると、譲渡人と譲受人の 2 行をまとめて作成します。',
  fields: [
    { key: 'stakeholderId', label: '株主', type: 'ref', ref: 'stakeholders', required: true, filterable: true },
    { key: 'shareClassId', label: '株式の種類', type: 'ref', ref: 'share-classes', required: true },
    { key: 'transactionType', label: '異動の種類', type: 'select', options: SHARE_TRANSACTION_TYPES, required: true, defaultValue: 'new_issue' },
    { key: 'transactionDate', label: '異動日', type: 'date', required: true, help: '株主名簿の「株式を取得した日」になります（払込期日・譲渡の効力発生日など）' },
    { key: 'shares', label: '株式数', type: 'integer', required: true, nonZero: true, min: -1_000_000_000_000, max: 1_000_000_000_000, aiHint: '取得は正、減少は負' },
    { key: 'pricePerShare', label: '1 株あたりの金額', type: 'decimal', min: 0 },
    { key: 'amount', label: '金額（合計）', type: 'yen', min: 0, help: '空欄なら 1 株あたりの金額 × 株式数で計算します' },
    { key: 'capitalAmount', label: 'うち資本金に組み入れた額', type: 'yen', min: 0 },
    { key: 'roundId', label: '資金調達ラウンド', type: 'ref', ref: 'funding-rounds', filterable: true },
    { key: 'counterparty', label: '相手方', type: 'text', maxLength: 200, help: '譲渡の相手方など' },
    notes(),
  ],
  orderBy: [
    { column: 'transactionDate', ascending: true },
    { column: 'createdAt', ascending: true },
  ],
  readOnlyColumns: ['groupId'],
  labelOf: (row) => `${text(row, 'transactionDate')} ${num(row, 'shares')?.toLocaleString('ja-JP') ?? ''}株`,
};

const convertibleRounds: ResourceDef = {
  name: 'convertible-rounds',
  table: 'convertible_rounds',
  label: '転換型証券の回次',
  formNote: 'J-KISS 型新株予約権も新株予約権の一種で、発行には株主総会の特別決議と登記が必要です。転換の条件（評価上限額・ディスカウント・適格資金調達の金額・転換期限）は契約書のとおりに入力してください。',
  fields: [
    { key: 'roundNo', label: '回次', type: 'integer', required: true, min: 1, max: 1000 },
    { key: 'name', label: '名称', type: 'text', required: true, maxLength: 100, placeholder: '第1回 J-KISS 型新株予約権' },
    { key: 'instrumentType', label: '種類', type: 'select', options: CONVERTIBLE_INSTRUMENT_TYPES, required: true, defaultValue: 'jkiss' },
    { key: 'status', label: '状態', type: 'select', options: CONVERTIBLE_STATUSES, required: true, defaultValue: 'outstanding' },
    { key: 'valuationCap', label: '評価上限額（バリュエーションキャップ）', type: 'yen', min: 1, placeholder: '3億', help: 'キャップなしの場合は空欄' },
    { key: 'capBasis', label: '評価上限額の基準', type: 'select', options: CAP_BASES, required: true, defaultValue: 'post_money', help: 'J-KISS 2.0 はポストマネー（転換後の株式を含めて割る）、1.x はプレマネーです。契約書の「完全希釈化後株式数」の定義を確認してください' },
    { key: 'discountRate', label: 'ディスカウント率（%）', type: 'percent', required: true, min: 0, max: 99.99, defaultValue: '20' },
    { key: 'qualifiedFinancingAmount', label: '適格資金調達の金額', type: 'yen', min: 1, defaultValue: '100,000,000', help: 'この金額以上の株式での資金調達があると転換します' },
    { key: 'issueDate', label: '発行日（割当日）', type: 'date' },
    { key: 'conversionDeadline', label: '転換期限', type: 'date', help: '期限までに適格資金調達が無い場合の扱いは契約書を確認してください' },
    notes(),
  ],
  orderBy: [{ column: 'roundNo', ascending: true }],
  labelOf: (row) => text(row, 'name'),
  validate: (values) => dateOrder(values, 'issueDate', 'conversionDeadline', '転換期限は発行日以降にしてください'),
};

const convertibleInvestments: ResourceDef = {
  name: 'convertible-investments',
  table: 'convertible_investments',
  label: '転換型証券の投資',
  fields: [
    { key: 'roundId', label: '回次', type: 'ref', ref: 'convertible-rounds', required: true, filterable: true },
    { key: 'stakeholderId', label: '投資家', type: 'ref', ref: 'stakeholders', required: true, filterable: true },
    { key: 'amount', label: '投資額（払込金額）', type: 'yen', required: true, min: 1, placeholder: '1,000万' },
    { key: 'investmentDate', label: '払込日', type: 'date' },
    { key: 'convertedShares', label: '転換して交付した株式数', type: 'integer', min: 0, help: '転換したときに入力します。株式の異動（転換）も合わせて記録してください' },
    { key: 'convertedOn', label: '転換日', type: 'date' },
    notes(),
  ],
  orderBy: [
    { column: 'investmentDate', ascending: true },
    { column: 'createdAt', ascending: true },
  ],
  labelOf: (row) => `${num(row, 'amount')?.toLocaleString('ja-JP') ?? ''}円`,
  validate: (values) =>
    (num(values, 'convertedShares') == null) !== (text(values, 'convertedOn') === '')
      ? { convertedOn: '転換した場合は、株式数と転換日の両方を入力してください' }
      : null,
};

const optionPlans: ResourceDef = {
  name: 'option-plans',
  table: 'option_plans',
  label: '新株予約権の回次',
  formNote: '非公開会社の新株予約権の発行は、株主総会の特別決議で募集事項を決めます（会社法238条2項・309条2項6号）。割当日から 2 週間以内に登記が必要です。内容は新株予約権原簿（249条）の記載事項になります。',
  fields: [
    { key: 'name', label: '名称', type: 'text', required: true, maxLength: 100, placeholder: '第1回新株予約権' },
    { key: 'planType', label: '種類', type: 'select', options: OPTION_PLAN_TYPES, required: true, defaultValue: 'tax_qualified' },
    { key: 'totalUnits', label: '発行する新株予約権の総数（個）', type: 'integer', required: true, min: 1 },
    { key: 'sharesPerUnit', label: '1 個あたりの目的となる株式数', type: 'integer', required: true, min: 1, defaultValue: '1' },
    { key: 'shareClassId', label: '目的となる株式の種類', type: 'ref', ref: 'share-classes' },
    { key: 'exercisePrice', label: '行使価額（1 株あたり）', type: 'decimal', required: true, min: 0 },
    { key: 'issuePrice', label: '発行価額（1 個あたりの払込金額）', type: 'decimal', required: true, min: 0, defaultValue: '0', help: '無償なら 0。税制適格は無償発行に限られます' },
    { key: 'fairValuePerShare', label: '付与契約時の 1 株あたりの時価', type: 'decimal', min: 0, help: '税制適格の判定（行使価額 ≧ 時価）に使います' },
    { key: 'resolutionDate', label: '発行決議日（株主総会）', type: 'date' },
    { key: 'allotmentDate', label: '割当日', type: 'date' },
    { key: 'exercisePeriodStart', label: '行使期間の開始日', type: 'date' },
    { key: 'exercisePeriodEnd', label: '行使期間の終了日', type: 'date' },
    { key: 'vestingMonths', label: 'ベスティング期間（月）', type: 'integer', min: 0, max: 600, placeholder: '48', help: '空欄ならベスティングなし' },
    { key: 'cliffMonths', label: 'クリフ（月）', type: 'integer', min: 0, max: 600, placeholder: '12' },
    { key: 'vestingInterval', label: '権利確定の間隔', type: 'select', options: VESTING_INTERVALS, required: true, defaultValue: 'monthly' },
    { key: 'registeredOn', label: '登記した日', type: 'date' },
    { key: 'exerciseConditions', label: '行使条件・取得条項', type: 'textarea', maxLength: 8000, width: 'full', help: '発行要項の行使条件（上場・M&A 条件、退職時の扱い、譲渡制限など）の要約' },
    notes(),
  ],
  orderBy: [
    { column: 'allotmentDate', ascending: true },
    { column: 'createdAt', ascending: true },
  ],
  labelOf: (row) => text(row, 'name'),
  validate: (values) => {
    const period = dateOrder(values, 'exercisePeriodStart', 'exercisePeriodEnd', '行使期間の終了日は開始日以降にしてください');
    if (period) return period;
    const vesting = num(values, 'vestingMonths');
    const cliff = num(values, 'cliffMonths');
    if (cliff != null && cliff > (vesting ?? 0)) return { cliffMonths: 'クリフはベスティング期間以下にしてください' };
    return null;
  },
};

const optionGrants: ResourceDef = {
  name: 'option-grants',
  table: 'option_grants',
  label: '新株予約権の割当',
  formNote: '割当先の氏名・住所、新株予約権の内容と数、取得日は新株予約権原簿の記載事項です（会社法249条）。取締役への付与は報酬等としての決議（361条）も必要です。',
  fields: [
    { key: 'planId', label: '回次', type: 'ref', ref: 'option-plans', required: true, filterable: true },
    { key: 'stakeholderId', label: '割当先', type: 'ref', ref: 'stakeholders', required: true, filterable: true },
    { key: 'holderRole', label: '割当先の区分', type: 'select', options: GRANT_ROLES, required: true, defaultValue: 'employee', help: '税制適格の付与対象者の判定に使います' },
    { key: 'units', label: '割当個数', type: 'integer', required: true, min: 1 },
    { key: 'grantedOn', label: '割当日', type: 'date' },
    { key: 'contractSignedOn', label: '割当契約の締結日', type: 'date' },
    { key: 'vestingStartOn', label: 'ベスティングの起算日', type: 'date', help: '空欄なら割当日から起算します（入社日などにする場合に入力）' },
    notes(),
  ],
  orderBy: [
    { column: 'grantedOn', ascending: true },
    { column: 'createdAt', ascending: true },
  ],
  labelOf: (row) => `${num(row, 'units')?.toLocaleString('ja-JP') ?? ''}個`,
};

const optionEvents: ResourceDef = {
  name: 'option-events',
  table: 'option_events',
  label: '新株予約権の行使・失効',
  formNote: '行使があった月の末日から 2 週間以内に変更の登記が必要です（会社法915条3項1号）。行使で交付した株式は、株式の異動（新株予約権の行使）にも記録してください。',
  fields: [
    { key: 'grantId', label: '割当', type: 'ref', ref: 'option-grants', required: true, filterable: true, immutable: true, aiSkip: true },
    { key: 'eventType', label: '種類', type: 'select', options: OPTION_EVENT_TYPES, required: true, defaultValue: 'exercise' },
    { key: 'eventDate', label: '行使日・失効日', type: 'date', required: true },
    { key: 'units', label: '個数', type: 'integer', required: true, min: 1 },
    notes(),
  ],
  orderBy: [
    { column: 'eventDate', ascending: true },
    { column: 'createdAt', ascending: true },
  ],
  labelOf: (row) => `${text(row, 'eventDate')} ${num(row, 'units')?.toLocaleString('ja-JP') ?? ''}個`,
};

const meetings: ResourceDef = {
  name: 'meetings',
  table: 'meetings',
  label: '会議',
  fields: [
    { key: 'meetingType', label: '会議の種類', type: 'select', options: MEETING_TYPES, required: true, filterable: true, defaultValue: 'agm' },
    { key: 'title', label: '名称', type: 'text', required: true, maxLength: 200, placeholder: '第3期 定時株主総会' },
    { key: 'format', label: '開催方法', type: 'select', options: MEETING_FORMATS, required: true, defaultValue: 'in_person', help: '書面決議は、株主総会では株主全員の同意（319条）、取締役会では定款の定めと取締役全員の同意（370条）が必要です' },
    { key: 'status', label: '進行状況', type: 'select', options: MEETING_STATUSES, required: true, defaultValue: 'planning' },
    { key: 'heldOn', label: '開催日（書面決議は決議があったとみなされる日）', type: 'date' },
    { key: 'startTime', label: '開始時刻', type: 'time', placeholder: '10:00' },
    { key: 'place', label: '場所', type: 'text', maxLength: 300, width: 'full', placeholder: '東京都千代田区… 当社本店会議室' },
    { key: 'fiscalYearId', label: '対象の事業年度', type: 'ref', ref: 'fiscal-years', aiSkip: true, help: '定時株主総会で選びます' },
    { key: 'recordDate', label: '基準日', type: 'date', help: '議決権を行使できる株主を確定する日。総会は基準日から 3 か月以内に開催します（会社法124条）' },
    { key: 'noticeSentOn', label: '招集通知を発送した日', type: 'date' },
    { key: 'chairperson', label: '議長', type: 'text', maxLength: 100 },
    { key: 'minutesPreparer', label: '議事録の作成者', type: 'text', maxLength: 100, help: '議事録の作成に係る職務を行った取締役' },
    { key: 'attendingOfficers', label: '出席した役員', type: 'textarea', maxLength: 2000, width: 'full', help: '議事録の記載事項です（取締役・監査役の氏名）' },
    { key: 'totalVotingRights', label: '議決権の総数（取締役会は取締役の総数）', type: 'integer', min: 0 },
    { key: 'presentVotingRights', label: '出席した議決権の数（取締役会は出席取締役数）', type: 'integer', min: 0, help: '委任状・書面による議決権行使を含みます' },
    { key: 'presentShareholders', label: '出席株主数', type: 'integer', min: 0 },
    { key: 'minutesFinalizedOn', label: '議事録を確定した日', type: 'date' },
    { key: 'minutesBody', label: '議事録', type: 'textarea', maxLength: 60_000, width: 'full', hidden: true, aiSkip: true },
    notes(),
  ],
  orderBy: [
    { column: 'heldOn', ascending: false },
    { column: 'createdAt', ascending: false },
  ],
  labelOf: (row) => text(row, 'title'),
  validate: (values): Record<string, string> | null => {
    const total = num(values, 'totalVotingRights');
    const present = num(values, 'presentVotingRights');
    if (total != null && present != null && present > total) {
      return { presentVotingRights: '出席した議決権の数は総数以下にしてください' };
    }
    const recordDate = text(values, 'recordDate');
    const heldOn = text(values, 'heldOn');
    if (recordDate && heldOn && recordDate > heldOn) return { recordDate: '基準日は開催日以前にしてください' };
    return null;
  },
};

const meetingAgendaItems: ResourceDef = {
  name: 'meeting-agenda-items',
  table: 'meeting_agenda_items',
  label: '議案',
  fields: [
    { key: 'meetingId', label: '会議', type: 'ref', ref: 'meetings', required: true, filterable: true, immutable: true, aiSkip: true, hidden: true },
    { key: 'sortOrder', label: '順番', type: 'integer', required: true, min: 0, max: 1000, defaultValue: '1', aiSkip: true },
    { key: 'itemType', label: '区分', type: 'select', options: AGENDA_ITEM_TYPES, required: true, defaultValue: 'resolution' },
    { key: 'title', label: '議題・議案', type: 'text', required: true, maxLength: 300, width: 'full', placeholder: '第1号議案 計算書類承認の件' },
    { key: 'resolutionType', label: '決議の種類', type: 'select', options: RESOLUTION_TYPES, required: true, defaultValue: 'ordinary', help: '定款変更・募集株式の発行・新株予約権の発行などは特別決議です（会社法309条2項）' },
    { key: 'result', label: '結果', type: 'select', options: AGENDA_RESULTS, required: true, defaultValue: 'pending' },
    { key: 'votesFor', label: '賛成', type: 'integer', min: 0 },
    { key: 'votesAgainst', label: '反対', type: 'integer', min: 0 },
    { key: 'votesAbstain', label: '棄権', type: 'integer', min: 0 },
    { key: 'description', label: '議案の内容・議事の経過', type: 'textarea', maxLength: 20_000, width: 'full' },
  ],
  orderBy: [
    { column: 'sortOrder', ascending: true },
    { column: 'createdAt', ascending: true },
  ],
  labelOf: (row) => text(row, 'title'),
};

const meetingResponses: ResourceDef = {
  name: 'meeting-responses',
  table: 'meeting_responses',
  label: '出欠・同意',
  fields: [
    { key: 'meetingId', label: '会議', type: 'ref', ref: 'meetings', required: true, filterable: true, immutable: true, aiSkip: true, hidden: true },
    { key: 'stakeholderId', label: '株主', type: 'ref', ref: 'stakeholders', immutable: true, aiSkip: true },
    { key: 'officerId', label: '役員', type: 'ref', ref: 'officers', immutable: true, aiSkip: true },
    { key: 'response', label: '回答', type: 'select', options: MEETING_RESPONSES, required: true, defaultValue: 'no_response' },
    { key: 'votingRights', label: '議決権の数', type: 'integer', min: 0 },
    { key: 'respondedOn', label: '回答日', type: 'date' },
    notes(),
  ],
  orderBy: [{ column: 'createdAt', ascending: true }],
  labelOf: (row) => text(row, 'response'),
  validate: (values) =>
    'stakeholderId' in values && (values.stakeholderId == null) === (values.officerId == null)
      ? { stakeholderId: '株主か役員のどちらか一方を選んでください' }
      : null,
};

const financialReports: ResourceDef = {
  name: 'financial-reports',
  table: 'financial_reports',
  label: '決算情報',
  formNote: '計算書類は定時株主総会の承認（取締役会設置会社で会計監査人を置く場合などは報告）を受け、総会の 2 週間前（取締役会を置かない会社は 1 週間前）から 5 年間、本店に備え置きます（会社法438条・442条）。',
  fields: [
    { key: 'title', label: '名称', type: 'text', required: true, maxLength: 200, placeholder: '第3期 決算' },
    { key: 'periodType', label: '期間の種類', type: 'select', options: FINANCIAL_PERIOD_TYPES, required: true, defaultValue: 'annual' },
    { key: 'periodStart', label: '期間の開始日', type: 'date', required: true },
    { key: 'periodEnd', label: '期間の終了日', type: 'date', required: true },
    { key: 'fiscalYearId', label: '事業年度', type: 'ref', ref: 'fiscal-years', aiSkip: true },
    { key: 'status', label: '状態', type: 'select', options: FINANCIAL_STATUSES, required: true, defaultValue: 'draft' },
    { key: 'revenue', label: '売上高', type: 'yen' },
    { key: 'grossProfit', label: '売上総利益', type: 'yen' },
    { key: 'operatingIncome', label: '営業利益', type: 'yen', aiHint: '損失は負の数' },
    { key: 'ordinaryIncome', label: '経常利益', type: 'yen', aiHint: '損失は負の数' },
    { key: 'netIncome', label: '当期純利益', type: 'yen', aiHint: '損失は負の数' },
    { key: 'totalAssets', label: '総資産', type: 'yen' },
    { key: 'netAssets', label: '純資産', type: 'yen', aiHint: '債務超過は負の数' },
    { key: 'cashAndDeposits', label: '現金及び預金', type: 'yen' },
    { key: 'interestBearingDebt', label: '有利子負債', type: 'yen' },
    { key: 'employees', label: '従業員数', type: 'integer', min: 0 },
    { key: 'approvedMeetingId', label: '承認した株主総会', type: 'ref', ref: 'meetings', aiSkip: true },
    { key: 'isPublishedToShareholders', label: '株主ポータルに公開する', type: 'boolean' },
    { key: 'highlights', label: 'ハイライト・コメント', type: 'textarea', maxLength: 8000, width: 'full', help: '株主に伝える要点（事業の進捗・増減の理由など）' },
  ],
  orderBy: [{ column: 'periodEnd', ascending: false }],
  readOnlyColumns: ['publishedAt'],
  labelOf: (row) => text(row, 'title'),
  validate: (values) => dateOrder(values, 'periodStart', 'periodEnd', '期間の終了日は開始日以降にしてください'),
};

const shareholderUpdates: ResourceDef = {
  name: 'shareholder-updates',
  table: 'shareholder_updates',
  label: '株主へのお知らせ',
  fields: [
    { key: 'title', label: 'タイトル', type: 'text', required: true, maxLength: 200, width: 'full' },
    { key: 'category', label: '種類', type: 'select', options: UPDATE_CATEGORIES, required: true, defaultValue: 'news' },
    { key: 'status', label: '公開状態', type: 'select', options: UPDATE_STATUSES, required: true, defaultValue: 'draft', help: '公開中にすると株主ポータルに表示されます' },
    { key: 'meetingId', label: '関連する株主総会', type: 'ref', ref: 'meetings', aiSkip: true },
    { key: 'body', label: '本文', type: 'textarea', maxLength: 40_000, width: 'full', help: '見出し（# ）・箇条書き（- ）が使えます' },
  ],
  orderBy: [{ column: 'createdAt', ascending: false }],
  readOnlyColumns: ['publishedAt'],
  labelOf: (row) => text(row, 'title'),
};

// 文面（body）には、差し込み項目を {{会社名}} のように書く（src/features/templates/services/placeholders.ts）。
// 画面は専用の編集画面（src/features/templates/）を使うので、汎用のフォームには出さない項目もある。
const documentTemplates: ResourceDef = {
  name: 'document-templates',
  table: 'document_templates',
  label: '文書テンプレート',
  fields: [
    { key: 'title', label: '名前', type: 'text', required: true, maxLength: 200, width: 'full', placeholder: '臨時株主総会の招集通知' },
    { key: 'kind', label: '種類', type: 'select', options: TEMPLATE_KINDS, required: true, filterable: true },
    { key: 'status', label: '確認の状態', type: 'select', options: TEMPLATE_STATUSES, required: true, defaultValue: 'draft', help: '文面を人が確かめたら「確認済み」にします' },
    { key: 'body', label: '文面', type: 'textarea', maxLength: 80_000, width: 'full', aiSkip: true },
    notes('メモ（社内向け）'),
  ],
  orderBy: [
    { column: 'kind', ascending: true },
    { column: 'createdAt', ascending: false },
  ],
  labelOf: (row) => text(row, 'title'),
};

// 事業年度は設定画面（管理者）で管理する。ここでは参照の選択肢としてだけ使う（書き込みは不可）。
const fiscalYears: ResourceDef = {
  name: 'fiscal-years',
  table: 'fiscal_years',
  label: '事業年度',
  fields: [
    { key: 'label', label: '名称', type: 'text', required: true, maxLength: 50 },
    { key: 'startDate', label: '開始日', type: 'date', required: true },
    { key: 'endDate', label: '終了日', type: 'date', required: true },
  ],
  orderBy: [{ column: 'startDate', ascending: false }],
  labelOf: (row) => text(row, 'label'),
};

export const RESOURCES = {
  stakeholders,
  officers,
  'share-classes': shareClasses,
  'funding-rounds': fundingRounds,
  'share-transactions': shareTransactions,
  'convertible-rounds': convertibleRounds,
  'convertible-investments': convertibleInvestments,
  'option-plans': optionPlans,
  'option-grants': optionGrants,
  'option-events': optionEvents,
  meetings,
  'meeting-agenda-items': meetingAgendaItems,
  'meeting-responses': meetingResponses,
  'financial-reports': financialReports,
  'shareholder-updates': shareholderUpdates,
  'document-templates': documentTemplates,
  'fiscal-years': fiscalYears,
} as const satisfies Record<string, ResourceDef>;

export type ResourceName = keyof typeof RESOURCES;

/** 汎用 API から書き込めないリソース（専用の画面・操作で管理する） */
export const READ_ONLY_RESOURCES: readonly ResourceName[] = ['fiscal-years'];

export const isResourceName = (value: string): value is ResourceName => Object.hasOwn(RESOURCES, value);

export const getResource = (name: ResourceName): ResourceDef => RESOURCES[name];
