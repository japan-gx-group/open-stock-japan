// AI 取り込みの型（サーバ依存なし。API・画面・テストが共有する）。
//
// AI が返すのは「提案」で、台帳へ書くのは人が確かめて「台帳に反映する」を押したときだけ。
// 人・法人・株式の種類は、読取りの結果の中では名前で表し（id ではない）、照合（matching.ts）で台帳の行に結びつける。

import type { ResourceValues } from '@/lib/resources/fields';

/** 文書の種類（利用者が選ぶ。'auto' は AI が先に判定する） */
export type ImportDocumentKind =
  | 'registry'
  | 'articles'
  | 'shareholder_list'
  | 'investment_agreement'
  | 'share_transfer'
  | 'convertible'
  | 'stock_option'
  | 'meeting_minutes'
  | 'financial_statements';

/** 提案のまとまり（反映先ごと） */
export type GroupKey =
  | 'company'
  | 'stakeholders'
  | 'shareClasses'
  | 'officers'
  | 'issuedShares'
  | 'fundingRound'
  | 'shareTransactions'
  | 'transfers'
  | 'convertibleRound'
  | 'convertibleInvestments'
  | 'optionPlan'
  | 'optionGrants'
  | 'meeting'
  | 'agendaItems'
  | 'financialReport';

export type ImportValue = string | number | boolean | null;
/** 読み取った 1 件。キーは項目名（リソース定義の key）と、参照先の名前（holderName など） */
export type ExtractedItem = Record<string, ImportValue>;

/** 検証を通した読取りの結果（document_extractions.result に保存する形） */
export interface ImportExtraction {
  documentKind: ImportDocumentKind;
  /** 文書の要約（1〜2 文） */
  summary: string;
  /** 文書の日付（契約日・作成日・証明日） */
  documentDate: string | null;
  warnings: string[];
  /** 提案。1 件だけのまとまり（ラウンド・会議など）も配列（0 件か 1 件）で持つ */
  groups: Partial<Record<GroupKey, ExtractedItem[]>>;
}

// ---- 照合 ----

export interface NamedRow {
  id: string;
  label: string;
}

export type MatchStatus = 'exact' | 'candidates' | 'none';

export interface NameMatch {
  status: MatchStatus;
  /** status が exact のときの id */
  id: string | null;
  /** 似た名前の候補（exact のときはその 1 件） */
  candidates: NamedRow[];
}

// ---- 台帳の今の状態（照合と確認に使う分だけ） ----

export interface ImportContext {
  stakeholders: NamedRow[];
  shareClasses: NamedRow[];
  fundingRounds: NamedRow[];
  convertibleRounds: (NamedRow & { roundNo: number })[];
  optionPlans: (NamedRow & { totalUnits: number })[];
  fiscalYears: (NamedRow & { startDate: string; endDate: string })[];
  officers: { id: string; name: string; position: string; retiredOn: string | null }[];
  meetings: { id: string; title: string; heldOn: string | null; meetingType: string }[];
  financialReports: { id: string; title: string; periodStart: string; periodEnd: string }[];
  shareTransactions: { stakeholderId: string; shareClassId: string; transactionDate: string; shares: number }[];
  optionGrants: { planId: string; stakeholderId: string; units: number }[];
  convertibleInvestments: { roundId: string; stakeholderId: string; amount: number }[];
  /** 会社情報の今の値（項目は COMPANY_DEF） */
  company: ResourceValues | null;
  /** 会社情報を変えられるか（管理者だけ） */
  canEditCompany: boolean;
}

// ---- 確認画面の行 ----

/** 参照の指定。''（未選択）/ 'existing:<uuid>'（登録済みの行）/ 'new:<行のキー>'（この取り込みで新しく作る行） */
export type RefValue = string;

export interface ReviewRow {
  /** 行のキー（例: stakeholders-0） */
  key: string;
  /** 台帳に反映するか */
  include: boolean;
  /** フォームの表示値（数値は文字列、率は %） */
  values: Record<string, string | boolean>;
  refs: Record<string, RefValue>;
  /** 会社情報だけ: 反映する項目 */
  ticked?: string[];
  /** 文書に書かれていた参照先の名前（表示用） */
  names: Record<string, string>;
  /** 参照ごとの照合の結果（表示用） */
  matches: Record<string, NameMatch>;
  /** この行そのものが、登録済みの行と一致したとき（新しく作らない既定にする） */
  existing: NamedRow | null;
  /** 似た名前の登録済みの行（別のものかを人が確かめる） */
  similar: NamedRow[];
}

export type ReviewState = Partial<Record<GroupKey, ReviewRow[]>>;

export interface RowIssues {
  /** 反映を止める問題 */
  errors: string[];
  fieldErrors: Record<string, string>;
  /** 確かめてほしい点（反映はできる） */
  warnings: string[];
}

export interface ReviewNotice {
  level: 'error' | 'warning' | 'info';
  message: string;
}

export interface ReviewCheck {
  rows: Record<string, RowIssues>;
  /** 行に紐づかない注意（登記簿との照合など） */
  notices: ReviewNotice[];
  errorCount: number;
  warningCount: number;
  includedCount: number;
}

// ---- 反映の記録 ----

export interface AppliedItem {
  id: string;
  label: string;
  /** 作った行を見られる画面（会議の詳細など。リソースだけでは決まらないとき） */
  href?: string;
}

/** document_extractions.appliedSummary に保存する形 */
export interface AppliedSummary {
  created: { group: GroupKey; resource: string; label: string; items: AppliedItem[] }[];
  /** 会社情報で更新した項目（key と表示名） */
  companyFields: { key: string; label: string }[];
  documentLink: { entityType: string; entityId: string } | null;
}

export type ExtractionStatus = 'extracted' | 'applied' | 'discarded';

export interface ExtractionSummaryRow {
  id: string;
  documentId: string;
  documentTitle: string;
  documentKind: ImportDocumentKind;
  status: ExtractionStatus;
  provider: string;
  modelId: string;
  createdAt: string;
  createdByName: string | null;
  appliedAt: string | null;
  appliedByName: string | null;
}

export interface ImportDocumentInfo {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
}

export interface ExtractionDetail extends ExtractionSummaryRow {
  result: ImportExtraction;
  appliedSummary: AppliedSummary | null;
  document: ImportDocumentInfo;
}

/** GET /api/import/<id>・POST /api/import/extract の応答 */
export interface ExtractionResponse {
  extraction: ExtractionDetail;
  /** 今の台帳との照合を済ませた、確認画面の初期状態 */
  review: ReviewState;
  context: ImportContext;
}
