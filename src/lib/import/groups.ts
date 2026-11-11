// 文書の種類と、提案のまとまり（反映先）の定義。サーバ依存なし。
//
// 1 つの定義から次が決まる:
//   - AI に返させる形（schema.ts）と指示文
//   - AI の出力の検証（validate.ts）
//   - 確認画面の項目（リソース定義の FieldDef をそのまま使う）と、反映の順番（applyPlan.ts）
// 項目の正本はリソース定義（src/lib/resources/definitions.ts・company.ts）。ここでは「どの項目を読ませ、どれを画面に出すか」だけを決める。

import { SHARE_TRANSACTION_TYPES } from '@/lib/equity/types';
import { COMPANY_DEF } from '@/lib/resources/company';
import { RESOURCES, type ResourceName } from '@/lib/resources/definitions';
import type { FieldDef, ResourceDef } from '@/lib/resources/fields';
import type { GroupKey, ImportDocumentKind } from './types';

/** 参照先（照合する台帳） */
export type RefTarget = 'stakeholders' | 'share-classes' | 'funding-rounds' | 'convertible-rounds' | 'option-plans' | 'meetings' | 'fiscal-years';

export interface RefSpec {
  /** 反映するときの項目名（stakeholderId など） */
  key: string;
  label: string;
  target: RefTarget;
  required: boolean;
  /** AI に読ませる名前の項目（holderName など）。無ければ名前では照合しない（同じ取り込みの中の行を既定にする） */
  nameKey?: string;
  /** AI への説明 */
  nameHint?: string;
  /** この取り込みの中で、参照先を新しく作れるまとまり */
  source?: GroupKey;
}

export type GroupTarget =
  | { type: 'resource'; resource: ResourceName }
  | { type: 'company' }
  /** 株式譲渡（譲渡人の減少と譲受人の増加の 2 行を 1 つの groupId で作る） */
  | { type: 'transfer' }
  /** 台帳には書かず、照合にだけ使う（登記簿の発行済株式数） */
  | { type: 'crosscheck' };

export interface GroupSpec {
  key: GroupKey;
  label: string;
  target: GroupTarget;
  /** 1 件だけ（ラウンド・会議・決算など） */
  single: boolean;
  maxItems: number;
  /** AI に読ませる項目（リソース定義の key） */
  aiFields: readonly string[];
  /** 確認画面に出す項目（AI に読ませない項目を足す。既定は aiFields） */
  extraReviewFields?: readonly string[];
  refs: readonly RefSpec[];
  /** これが読み取れなかった件は捨てる（項目名または参照の nameKey） */
  requiredKeys: readonly string[];
  /** AI への補足（まとまり全体） */
  hint?: string;
  /** 項目ごとの AI への補足 */
  fieldHints?: Record<string, string>;
  /** 画面の並べ方。table は 1 件 1 行、form は項目を並べた枠 */
  layout: 'table' | 'form';
  /** 行の表示名に使う項目 */
  labelKey?: string;
}

const TRANSFER_FIELDS: FieldDef[] = [
  { key: 'transactionDate', label: '譲渡日', type: 'date', required: true },
  { key: 'shares', label: '株式数', type: 'integer', required: true, min: 1, max: 1_000_000_000_000 },
  { key: 'pricePerShare', label: '1 株あたりの譲渡価格', type: 'decimal', min: 0 },
  { key: 'notes', label: 'メモ', type: 'textarea', maxLength: 4000 },
];

const CROSSCHECK_FIELDS: FieldDef[] = [
  { key: 'shareClassName', label: '株式の種類', type: 'text', maxLength: 100 },
  { key: 'shares', label: '発行済株式数', type: 'integer', min: 0 },
];

const STAKEHOLDER_REF = (key: string, nameKey: string, label: string, nameHint: string): RefSpec => ({
  key,
  label,
  target: 'stakeholders',
  required: true,
  nameKey,
  nameHint,
  source: 'stakeholders',
});

const SHARE_CLASS_REF = (required: boolean, source?: GroupKey): RefSpec => ({
  key: 'shareClassId',
  label: '株式の種類',
  target: 'share-classes',
  required,
  nameKey: 'shareClassName',
  nameHint: '株式の種類の名称（例: 普通株式、A種優先株式）。種類の記載が無く普通株式だけの会社と読めるときは「普通株式」',
  source,
});

export const GROUP_SPECS: Record<GroupKey, GroupSpec> = {
  company: {
    key: 'company',
    label: '会社情報',
    target: { type: 'company' },
    single: true,
    maxItems: 1,
    aiFields: [],
    refs: [],
    requiredKeys: [],
    layout: 'form',
    fieldHints: {
      fiscalYearStartMonth: '事業年度の開始月（1〜12 の数字を文字で。「毎年4月1日から翌年3月31日まで」なら "4"）',
      isPublicCompany: '株式の譲渡制限の定めが無い（公開会社）なら true',
      hasTransferRestriction: '「株式の譲渡制限に関する規定」がある（譲渡に会社の承認が要る）なら true',
      hasBoardOfDirectors: '「取締役会設置会社」の記載・定めがあれば true、無ければ false',
      hasAuditor: '「監査役設置会社」の記載・定めがあれば true、無ければ false',
      auditorLimitedToAccounting: '「監査役の監査の範囲を会計に関するものに限定する」旨の記載・定めがあれば true',
      issuesShareCertificates: '「株券発行会社」の記載・「株券を発行する」定めがあれば true',
      allowsBoardWrittenResolution: '取締役会の決議の省略（会社法370条。書面・電磁的記録による同意）の定めがあれば true',
      shareholderMeetingNoticeDays: '株主総会の招集通知を会日の何日前までに発するか（定款に日数の定めがあるときだけ。「1週間前」は 7）',
      boardMeetingNoticeDays: '取締役会の招集通知を会日の何日前までに発するか（「3日前」は 3）',
      directorTermYears: '取締役の任期の年数（「選任後10年以内に終了する事業年度…」は 10）',
      auditorTermYears: '監査役の任期の年数',
      recordDateRule: '定時株主総会の議決権の基準日の定め（条文の要点を短く）',
      businessDescription: '目的（事業の内容）。号ごとに改行',
      capitalAmount: '資本金の額（円の整数）',
      authorizedShares: '発行可能株式総数（株）',
      corporateNumber: '会社法人等番号ではなく、13 桁の法人番号が書かれているときだけ',
    },
  },
  stakeholders: {
    key: 'stakeholders',
    label: '株主・権利者',
    target: { type: 'resource', resource: 'stakeholders' },
    single: false,
    maxItems: 60,
    aiFields: ['name', 'nameKana', 'kind', 'relationship', 'postalCode', 'address', 'contactPerson'],
    refs: [],
    requiredKeys: ['name'],
    hint: '文書に出てくる株主・投資家・譲渡人・譲受人・新株予約権者。発行会社自身は含めない。同じ人は 1 件にまとめる',
    fieldHints: {
      kind: '個人は individual、株式会社などの法人は corporation、投資事業有限責任組合などのファンドは fund',
      relationship: '文書から分かる範囲で（引受人・投資家は investor、創業者は founder、役員は officer、従業員は employee）。分からなければ null',
      contactPerson: '法人・組合の代表者や担当者の氏名（肩書は付けない）',
    },
    layout: 'table',
    labelKey: 'name',
  },
  shareClasses: {
    key: 'shareClasses',
    label: '株式の種類',
    target: { type: 'resource', resource: 'share-classes' },
    single: false,
    maxItems: 12,
    aiFields: ['name', 'kind', 'originalIssuePrice', 'authorizedShares', 'liquidationMultiple', 'participation', 'participationCapMultiple', 'hasVotingRights', 'dividendPreference', 'terms'],
    extraReviewFields: ['seniority', 'conversionRatio', 'antiDilution'],
    refs: [],
    requiredKeys: ['name'],
    hint: '文書に内容が書かれている株式の種類（普通株式を含む）。名前だけ出てくる種類は、内容の項目を null にして 1 件にする',
    fieldHints: {
      kind: '普通株式は common、優先株式は preferred、それ以外の種類株式は other',
      terms: '取得請求権・取得条項・拒否権・議決権の制限など、種類株式の内容の要点（300 字以内に要約）',
      liquidationMultiple: '残余財産の優先分配が払込金額の何倍か（1 倍なら 1）。定めが無ければ null',
    },
    layout: 'form',
    labelKey: 'name',
  },
  officers: {
    key: 'officers',
    label: '役員',
    target: { type: 'resource', resource: 'officers' },
    single: false,
    maxItems: 30,
    aiFields: ['name', 'position', 'isOutside', 'appointedOn', 'registeredOn'],
    refs: [],
    requiredKeys: ['name'],
    hint: '現に在任している役員だけ（下線で抹消された記載・退任・辞任した人は含めない）。代表取締役が取締役としても記載されているときは、代表取締役の 1 件だけにする',
    fieldHints: {
      appointedOn: '直近の就任日または重任日（「令和6年6月28日重任」ならその日）',
      registeredOn: 'その就任・重任を登記した日',
      isOutside: '「（社外取締役）」「（社外監査役）」の記載があれば true',
    },
    layout: 'table',
    labelKey: 'name',
  },
  issuedShares: {
    key: 'issuedShares',
    label: '発行済株式の総数（台帳との照合）',
    target: { type: 'crosscheck' },
    single: false,
    maxItems: 12,
    aiFields: ['shareClassName', 'shares'],
    refs: [],
    requiredKeys: ['shares'],
    hint: '「発行済株式の総数並びに種類及び数」。種類ごとに 1 件。種類株式を発行していなければ「普通株式」の 1 件',
    layout: 'table',
  },
  fundingRound: {
    key: 'fundingRound',
    label: '資金調達ラウンド',
    target: { type: 'resource', resource: 'funding-rounds' },
    single: true,
    maxItems: 1,
    aiFields: ['name', 'roundType', 'pricePerShare', 'preMoneyValuation', 'targetAmount', 'capitalIncreaseAmount', 'resolutionDate', 'closingDate'],
    extraReviewFields: ['status'],
    refs: [SHARE_CLASS_REF(false, 'shareClasses')],
    requiredKeys: [],
    hint: 'この契約で行う募集株式の発行（1 回分）',
    fieldHints: {
      name: 'ラウンドの呼び名（文書に「シリーズA」などがあればそれ。無ければ「A種優先株式の発行」のように株式の種類から短く）',
      roundType: '文書から分かるときだけ（シリーズA なら series_a）。分からなければ null',
      targetAmount: '払込金額の総額（円の整数）',
      capitalIncreaseAmount: '増加する資本金の額の総額（円の整数）',
      resolutionDate: '募集事項を決めた株主総会（または取締役会）の決議日',
      closingDate: '払込期日（期間のときは末日）',
    },
    layout: 'form',
    labelKey: 'name',
  },
  shareTransactions: {
    key: 'shareTransactions',
    label: '株式の異動',
    target: { type: 'resource', resource: 'share-transactions' },
    single: false,
    maxItems: 100,
    aiFields: ['transactionDate', 'shares', 'pricePerShare', 'amount', 'capitalAmount'],
    extraReviewFields: ['transactionType'],
    refs: [
      STAKEHOLDER_REF('stakeholderId', 'holderName', '株主', '株主・引受人の氏名または名称（文書の表記のまま）'),
      SHARE_CLASS_REF(true, 'shareClasses'),
      { key: 'roundId', label: '資金調達ラウンド', target: 'funding-rounds', required: false, source: 'fundingRound' },
    ],
    requiredKeys: ['holderName'],
    fieldHints: {
      shares: '株式数（正の整数）',
      amount: 'その人の払込金額・取得価額の合計（円の整数）',
      capitalAmount: 'そのうち資本金に組み入れる額（円の整数）。人ごとの記載が無ければ null',
    },
    layout: 'table',
  },
  transfers: {
    key: 'transfers',
    label: '株式譲渡',
    target: { type: 'transfer' },
    single: false,
    maxItems: 20,
    aiFields: ['transactionDate', 'shares', 'pricePerShare'],
    extraReviewFields: ['notes'],
    refs: [
      STAKEHOLDER_REF('fromStakeholderId', 'fromName', '譲渡人', '譲渡人（売主）の氏名または名称'),
      STAKEHOLDER_REF('toStakeholderId', 'toName', '譲受人', '譲受人（買主）の氏名または名称'),
      SHARE_CLASS_REF(true),
    ],
    requiredKeys: ['fromName', 'toName'],
    hint: '株式の譲渡。譲渡人・譲受人・種類の組み合わせごとに 1 件',
    fieldHints: {
      transactionDate: '譲渡の効力が生じる日（譲渡実行日・クロージング日。定めが無ければ契約締結日）',
      shares: '譲渡する株式数（正の整数）',
      pricePerShare: '1 株あたりの譲渡価格（総額だけのときは総額 ÷ 株式数。割り切れなければ null）',
    },
    layout: 'table',
  },
  convertibleRound: {
    key: 'convertibleRound',
    label: '転換型証券の回次',
    target: { type: 'resource', resource: 'convertible-rounds' },
    single: true,
    maxItems: 1,
    aiFields: ['roundNo', 'name', 'instrumentType', 'valuationCap', 'capBasis', 'discountRate', 'qualifiedFinancingAmount', 'issueDate', 'conversionDeadline'],
    extraReviewFields: ['status'],
    refs: [],
    requiredKeys: [],
    fieldHints: {
      roundNo: '「第1回」などの回次の数字。書かれていなければ null',
      name: '新株予約権の名称（例: 第1回 J-KISS 型新株予約権）',
      valuationCap: '評価上限額（バリュエーションキャップ。円の整数）。定めが無ければ null',
      capBasis: '評価上限額がポストマネー基準（転換後の株式を含めて割る。J-KISS 2.0）なら post_money、プレマネー基準なら pre_money。文書から判断できなければ null',
      discountRate: 'ディスカウント率（%）。「転換価額は株価の 80%」は 20',
      qualifiedFinancingAmount: '適格資金調達となる調達額の下限（円の整数）',
      conversionDeadline: '転換期限（期限までに適格資金調達が無い場合に転換できるようになる日）',
    },
    layout: 'form',
    labelKey: 'name',
  },
  convertibleInvestments: {
    key: 'convertibleInvestments',
    label: '転換型証券の投資',
    target: { type: 'resource', resource: 'convertible-investments' },
    single: false,
    maxItems: 40,
    aiFields: ['amount', 'investmentDate'],
    refs: [
      { key: 'roundId', label: '回次', target: 'convertible-rounds', required: true, source: 'convertibleRound' },
      STAKEHOLDER_REF('stakeholderId', 'investorName', '投資家', '投資家（新株予約権の割当てを受ける者）の氏名または名称'),
    ],
    requiredKeys: ['investorName'],
    fieldHints: { amount: 'その投資家の払込金額（円の整数）', investmentDate: '払込期日・払込日' },
    layout: 'table',
  },
  optionPlan: {
    key: 'optionPlan',
    label: '新株予約権の回次',
    target: { type: 'resource', resource: 'option-plans' },
    single: true,
    maxItems: 1,
    aiFields: [
      'name', 'planType', 'totalUnits', 'sharesPerUnit', 'exercisePrice', 'issuePrice', 'fairValuePerShare', 'resolutionDate', 'allotmentDate',
      'exercisePeriodStart', 'exercisePeriodEnd', 'vestingMonths', 'cliffMonths', 'vestingInterval', 'exerciseConditions',
    ],
    refs: [SHARE_CLASS_REF(false)],
    requiredKeys: [],
    fieldHints: {
      planType: '税制適格の要件に沿う旨（租税特別措置法29条の2）が書かれていれば tax_qualified、有償で発行するなら paid、信託型なら trust、判断できなければ null',
      totalUnits: 'この回次で発行する新株予約権の総数（個）。割当契約で総数が分からなければ null',
      issuePrice: '新株予約権 1 個あたりの払込金額（無償・金銭の払込みを要しないなら 0）',
      vestingMonths: '権利がすべて確定するまでの月数（4 年なら 48）。定めが無ければ null',
      cliffMonths: '最初の権利確定までの月数（1 年なら 12）',
      exerciseConditions: '行使条件・取得条項の要点（400 字以内に要約）',
    },
    layout: 'form',
    labelKey: 'name',
  },
  optionGrants: {
    key: 'optionGrants',
    label: '新株予約権の割当',
    target: { type: 'resource', resource: 'option-grants' },
    single: false,
    maxItems: 100,
    aiFields: ['holderRole', 'units', 'grantedOn', 'contractSignedOn', 'vestingStartOn'],
    refs: [
      { key: 'planId', label: '回次', target: 'option-plans', required: true, source: 'optionPlan' },
      STAKEHOLDER_REF('stakeholderId', 'holderName', '割当先', '割当てを受ける者（新株予約権者）の氏名または名称'),
    ],
    requiredKeys: ['holderName'],
    fieldHints: {
      holderRole: '割当先の立場（当社の取締役は director、従業員は employee、社外協力者は advisor）。書かれていなければ null',
      units: '割り当てる新株予約権の個数',
      vestingStartOn: 'ベスティングの起算日が割当日と別に定められているときだけ',
    },
    layout: 'table',
  },
  meeting: {
    key: 'meeting',
    label: '会議',
    target: { type: 'resource', resource: 'meetings' },
    single: true,
    maxItems: 1,
    aiFields: [
      'meetingType', 'title', 'format', 'heldOn', 'startTime', 'place', 'recordDate', 'chairperson', 'minutesPreparer', 'attendingOfficers',
      'totalVotingRights', 'presentVotingRights', 'presentShareholders',
    ],
    extraReviewFields: ['status'],
    refs: [],
    requiredKeys: [],
    fieldHints: {
      meetingType: '定時株主総会は agm、臨時株主総会は egm、種類株主総会は class_meeting、取締役会は board',
      title: '会議の名称（例: 第3期 定時株主総会、第20回 取締役会）。「議事録」の語は付けない',
      chairperson: '議長の氏名（肩書は付けない）',
      minutesPreparer: '議事録を作成した取締役の氏名（肩書は付けない）',
      format: '会場で開催は in_person、オンラインのみは online、併用は hybrid、決議の省略（書面決議・みなし決議）は written_resolution',
      heldOn: '開催日（書面決議は決議があったものとみなされた日）',
      attendingOfficers: '出席した取締役・監査役の役職と氏名（1 人 1 行）',
      totalVotingRights: '株主総会は議決権を行使できる株主の議決権の総数、取締役会は取締役の総数',
      presentVotingRights: '株主総会は出席株主（委任状・書面を含む）の議決権の数、取締役会は出席した取締役の数',
      presentShareholders: '出席した株主の数（株主総会のときだけ）',
    },
    layout: 'form',
    labelKey: 'title',
  },
  agendaItems: {
    key: 'agendaItems',
    label: '議案',
    target: { type: 'resource', resource: 'meeting-agenda-items' },
    single: false,
    maxItems: 30,
    aiFields: ['sortOrder', 'itemType', 'title', 'resolutionType', 'result', 'votesFor', 'votesAgainst', 'votesAbstain', 'description'],
    refs: [{ key: 'meetingId', label: '会議', target: 'meetings', required: true, source: 'meeting' }],
    requiredKeys: ['title'],
    fieldHints: {
      sortOrder: '議事録に出てくる順番（1 から）',
      itemType: '決議事項は resolution、報告事項は report',
      title: '議題・議案の件名（例: 第1号議案 計算書類承認の件）',
      resolutionType:
        '取締役会の議題は、報告事項も含めて board。株主総会は、定款変更・募集株式の発行・新株予約権の発行などの特別決議は special、役員の選任・計算書類の承認・報告事項などは ordinary、株主全員の同意は unanimous。判断できなければ null',
      result: '可決・承認は approved、否決は rejected、報告事項は reported。結果が書かれていなければ null',
      description: '議案の内容と議事の経過の要点（200 字以内に要約）',
    },
    layout: 'table',
    labelKey: 'title',
  },
  financialReport: {
    key: 'financialReport',
    label: '決算情報',
    target: { type: 'resource', resource: 'financial-reports' },
    single: true,
    maxItems: 1,
    aiFields: [
      'title', 'periodType', 'periodStart', 'periodEnd', 'revenue', 'grossProfit', 'operatingIncome', 'ordinaryIncome', 'netIncome',
      'totalAssets', 'netAssets', 'cashAndDeposits', 'interestBearingDebt', 'employees', 'highlights',
    ],
    extraReviewFields: ['status'],
    refs: [{ key: 'fiscalYearId', label: '事業年度', target: 'fiscal-years', required: false }],
    requiredKeys: [],
    hint: '金額は円の整数に直す（「単位: 千円」の表なら 1,000 倍、「百万円」なら 1,000,000 倍）。損失・マイナス（△・▲・かっこ書き）は負の数',
    fieldHints: {
      title: '名称（例: 第3期 決算）',
      periodType: '1 年の決算は annual、半期は half、四半期は quarterly、月次は monthly',
      interestBearingDebt: '借入金・社債などの有利子負債の合計。内訳から確実に合計できるときだけ',
      highlights: '文書に書かれている業績の説明の要点（200 字以内）。無ければ null',
      cashAndDeposits: '貸借対照表の「現金及び預金」',
    },
    layout: 'form',
    labelKey: 'title',
  },
};

/** 文書の種類ごとの会社情報の項目 */
const COMPANY_FIELDS: Partial<Record<ImportDocumentKind, readonly string[]>> = {
  registry: [
    'name', 'corporateNumber', 'address', 'establishedOn', 'capitalAmount', 'authorizedShares', 'publicNoticeMethod', 'isPublicCompany',
    'hasTransferRestriction', 'hasBoardOfDirectors', 'hasAuditor', 'auditorLimitedToAccounting', 'issuesShareCertificates', 'businessDescription',
  ],
  articles: [
    'name', 'nameEn', 'fiscalYearStartMonth', 'authorizedShares', 'publicNoticeMethod', 'isPublicCompany', 'hasTransferRestriction',
    'hasBoardOfDirectors', 'hasAuditor', 'auditorLimitedToAccounting', 'issuesShareCertificates', 'allowsBoardWrittenResolution',
    'shareholderMeetingNoticeDays', 'boardMeetingNoticeDays', 'directorTermYears', 'auditorTermYears', 'recordDateRule',
  ],
};

export interface DocumentKindDef {
  value: ImportDocumentKind;
  label: string;
  /** 何が埋まるかの 1 行の説明 */
  description: string;
  /** 文書ライブラリの分類 */
  category: string;
  groups: readonly GroupKey[];
  /** AI への補足（文書の種類ごと） */
  hint: string;
}

export const DOCUMENT_KINDS: readonly DocumentKindDef[] = [
  {
    value: 'registry',
    label: '登記事項証明書（履歴事項全部証明書）',
    description: '会社情報（商号・本店・資本金・機関設計など）、役員、株式の種類を読み取り、発行済株式数を台帳と照合します',
    category: 'registry',
    groups: ['company', 'officers', 'shareClasses', 'issuedShares'],
    hint: '登記事項証明書です。下線のある記載は抹消された（今は効力の無い）事項なので、現に効力のある記載だけを読み取ってください。',
  },
  {
    value: 'articles',
    label: '定款',
    description: '事業年度・公告方法・役員の任期・招集通知の期間・書面決議の定めなど、会社情報の定款に関する項目と、種類株式の内容を読み取ります',
    category: 'articles',
    groups: ['company', 'shareClasses'],
    hint: '定款です。定めが無い項目は null にしてください（法定どおりとして扱います）。',
  },
  {
    value: 'shareholder_list',
    label: '株主名簿・資本政策表',
    description: '株主と、今の持株数を読み取ります（過去の異動の履歴は復元しません）',
    category: 'other',
    groups: ['stakeholders', 'shareClasses', 'shareTransactions'],
    hint: '株主名簿または資本政策表です。株主 × 株式の種類ごとに、今の持株数を shareTransactions の 1 件にしてください（shares は持株数。transactionDate は名簿の基準日・作成日が書かれていればその日、無ければ null。取得日が株主ごとに書かれていても基準日を使う）。新株予約権・潜在株式の行は含めません。合計の行も含めません。',
  },
  {
    value: 'investment_agreement',
    label: '投資契約・総数引受契約・募集株式の引受け',
    description: '資金調達ラウンド、引受人（投資家）、引受けごとの株式の異動（募集株式の発行）を読み取ります',
    category: 'investment_agreement',
    groups: ['stakeholders', 'shareClasses', 'fundingRound', 'shareTransactions'],
    hint: '募集株式の引受けに関する契約（投資契約・総数引受契約・株式引受契約・申込証）です。引受人ごとに shareTransactions の 1 件にしてください（transactionDate は払込期日。期間のときは末日）。shareClasses には、この契約に内容が書かれている種類株式だけを入れます。',
  },
  {
    value: 'share_transfer',
    label: '株式譲渡契約',
    description: '譲渡人・譲受人と、株式譲渡（譲渡人の減少と譲受人の増加）を読み取ります',
    category: 'share_transfer',
    groups: ['stakeholders', 'transfers'],
    hint: '株式譲渡契約（または譲渡承認請求書・株主名簿書換請求書）です。',
  },
  {
    value: 'convertible',
    label: 'J-KISS 型新株予約権・転換型の投資契約',
    description: '転換型証券の回次（評価上限額・ディスカウント・適格資金調達の金額・転換期限）と、投資家ごとの投資を読み取ります',
    category: 'convertible',
    groups: ['stakeholders', 'convertibleRound', 'convertibleInvestments'],
    hint: 'J-KISS 型新株予約権などの転換型証券の投資契約・発行要項です。',
  },
  {
    value: 'stock_option',
    label: '新株予約権 発行要項・割当契約',
    description: '新株予約権の回次（行使価額・行使期間・ベスティングなど）と、割当先ごとの割当を読み取ります',
    category: 'stock_option',
    groups: ['stakeholders', 'optionPlan', 'optionGrants'],
    hint: 'ストックオプション（新株予約権）の発行要項または割当契約です。',
  },
  {
    value: 'meeting_minutes',
    label: '株主総会議事録・取締役会議事録',
    description: '会議（開催日・場所・議長・出席役員・議決権の数）と議案（件名・決議の種類・結果）を読み取ります',
    category: 'meeting',
    groups: ['meeting', 'agendaItems'],
    hint: '株主総会または取締役会の議事録（書面決議の場合は同意書・提案書を含む）です。',
  },
  {
    value: 'financial_statements',
    label: '決算書（計算書類）',
    description: '決算情報（売上高・利益・総資産・純資産・現預金など）を読み取ります',
    category: 'financial',
    groups: ['financialReport'],
    hint: '決算書（貸借対照表・損益計算書などの計算書類、または決算の概要）です。当期の数値だけを読み取ってください（前期の列は使わない）。',
  },
];

export const isImportDocumentKind = (value: unknown): value is ImportDocumentKind =>
  typeof value === 'string' && DOCUMENT_KINDS.some((kind) => kind.value === value);

export const documentKindDef = (kind: ImportDocumentKind): DocumentKindDef =>
  DOCUMENT_KINDS.find((item) => item.value === kind) as DocumentKindDef;

export const documentKindLabel = (kind: string): string => DOCUMENT_KINDS.find((item) => item.value === kind)?.label ?? kind;

export const groupsOfKind = (kind: ImportDocumentKind): GroupSpec[] => documentKindDef(kind).groups.map((key) => GROUP_SPECS[key]);

/** まとまりの元になるリソース定義（会社情報・リソース）。譲渡・照合は null */
export const resourceDefOf = (spec: GroupSpec): ResourceDef | null =>
  spec.target.type === 'resource' ? RESOURCES[spec.target.resource] : spec.target.type === 'company' ? COMPANY_DEF : null;

const baseFieldsOf = (spec: GroupSpec): readonly FieldDef[] => {
  if (spec.target.type === 'transfer') return TRANSFER_FIELDS;
  if (spec.target.type === 'crosscheck') return CROSSCHECK_FIELDS;
  return (resourceDefOf(spec) as ResourceDef).fields;
};

const pick = (fields: readonly FieldDef[], keys: readonly string[]): FieldDef[] =>
  keys.map((key) => fields.find((field) => field.key === key)).filter((field): field is FieldDef => field !== undefined);

// 株主名簿からの取り込みで選べる異動の種類（今の持株を 1 件として入れるだけなので、設立時発行かその他）
const HOLDING_TRANSACTION_TYPES = SHARE_TRANSACTION_TYPES.filter((option) => option.value === 'other' || option.value === 'founding');
const ISSUE_TRANSACTION_TYPES = SHARE_TRANSACTION_TYPES.filter((option) => option.value === 'new_issue' || option.value === 'founding' || option.value === 'other');

const aiKeysOf = (spec: GroupSpec, kind: ImportDocumentKind): readonly string[] =>
  spec.target.type === 'company' ? (COMPANY_FIELDS[kind] ?? []) : spec.aiFields;

/** AI に読ませる項目 */
export const aiFieldsOf = (spec: GroupSpec, kind: ImportDocumentKind): FieldDef[] => pick(baseFieldsOf(spec), aiKeysOf(spec, kind));

/** 確認画面に出して、反映のときに受け取る項目 */
export const reviewFieldsOf = (spec: GroupSpec, kind: ImportDocumentKind): FieldDef[] => {
  const fields = pick(baseFieldsOf(spec), [...aiKeysOf(spec, kind), ...(spec.extraReviewFields ?? [])]);
  if (spec.key !== 'shareTransactions') return fields;
  const options = kind === 'shareholder_list' ? HOLDING_TRANSACTION_TYPES : ISSUE_TRANSACTION_TYPES;
  return fields.map((field) => (field.key === 'transactionType' ? { ...field, options } : field));
};

/** 確認画面での初期値（AI が読まない項目・読み取れなかった項目） */
export const reviewDefaultsOf = (spec: GroupSpec, kind: ImportDocumentKind): Record<string, string> => {
  switch (spec.key) {
    case 'shareTransactions':
      return { transactionType: kind === 'shareholder_list' ? 'other' : 'new_issue' };
    case 'fundingRound':
      return { status: 'closed', roundType: 'other' };
    case 'convertibleRound':
      return { status: 'outstanding' };
    case 'meeting':
      return { status: 'held' };
    case 'financialReport':
      return { status: 'draft' };
    default:
      return {};
  }
};

/** 反映の順番（参照される側が先）。会社情報は最後（失敗しても、作った行を消すだけで戻せるように） */
export const APPLY_ORDER: readonly GroupKey[] = [
  'stakeholders',
  'shareClasses',
  'officers',
  'fundingRound',
  'convertibleRound',
  'optionPlan',
  'meeting',
  'financialReport',
  'shareTransactions',
  'transfers',
  'convertibleInvestments',
  'optionGrants',
  'agendaItems',
  'company',
];

/** 文書に関連づける先（documents.entityType）。先にあるものを優先する */
export const DOCUMENT_LINK_TARGETS: readonly { group: GroupKey; entityType: string }[] = [
  { group: 'fundingRound', entityType: 'funding_round' },
  { group: 'convertibleRound', entityType: 'convertible_round' },
  { group: 'optionPlan', entityType: 'option_plan' },
  { group: 'meeting', entityType: 'meeting' },
  { group: 'financialReport', entityType: 'financial_report' },
];
