// 監査ログの画面と API で共有する型。サーバ依存なし。

export const AUDIT_SOURCES = ['app', 'db', 'auth'] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_OUTCOMES = ['success', 'failure', 'denied'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** system_audit_logs の 1 行（DB の列のまま）。oldValues / newValues は DB の jsonb */
export interface AuditLogRow {
  id: string;
  organizationId: string;
  userId: string | null;
  action: string;
  entityName: string;
  entityId: string | null;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
  /** 組織ごとの連番。連鎖を入れる前の記録だけ null */
  seq: number | null;
  prevHash: string | null;
  hash: string | null;
  source: string;
  outcome: string;
  actorEmail: string | null;
  actorRole: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

/** 一覧の 1 行。値の中身（変更前後）は持たず、変わった列の名前だけを持つ（中身は詳細で読む） */
export interface AuditLogItem {
  id: string;
  seq: number | null;
  createdAt: string;
  source: string;
  outcome: string;
  action: string;
  entityName: string;
  entityId: string | null;
  /** 対象の行の名前（氏名・タイトルなど）。分からなければ null */
  entityLabel: string | null;
  userId: string | null;
  /** 操作した人の氏名（いまの登録名）。アカウントが削除済みなら null */
  actorName: string | null;
  /** 操作した時点のメールアドレスとロール */
  actorEmail: string | null;
  actorRole: string | null;
  ipAddress: string | null;
  requestId: string | null;
  /** 変更前後の値に含まれる列の名前（データの変更の記録）。値は含めない */
  changedColumns: string[];
}

/** 詳細（1 行のすべての項目） */
export interface AuditLogDetail extends AuditLogItem {
  detail: string | null;
  userAgent: string | null;
  prevHash: string | null;
  hash: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  /** 続きを読むときに cursor に渡す値。続きが無ければ null */
  nextCursor: string | null;
  /** 条件に合う記録の件数（最初のページでだけ返す） */
  total?: number;
}

/** 連鎖の検査（verify_audit_log_chain）の結果 */
export type ChainVerifyResult =
  | { ok: true; count: number; lastSeq: number; lastHash: string; legacyCount: number; checkedAt: string }
  | { ok: false; reason: string; seq: number; count: number; expectedSeq?: number };

/** 控えておいた連番とハッシュを、いまの記録と突き合わせた結果 */
export interface AnchorCheckResult {
  seq: number;
  /** その連番の記録が残っているか */
  found: boolean;
  /** 残っていて、ハッシュが控えと同じか */
  matches: boolean;
}

export interface VerifyResponse {
  result: ChainVerifyResult;
  anchor: AnchorCheckResult | null;
}

export const ACCOUNT_STATUSES = ['active', 'never', 'dormant', 'banned'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** 棚卸しの 1 行（アカウント） */
export interface AccountAccessItem {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  stakeholderId: string | null;
  /** 株主のアカウントが紐づく権利者の名前 */
  stakeholderName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  mfaFactorCount: number;
  bannedUntil: string | null;
  status: AccountStatus;
}

/** 棚卸しの 1 行（まだ受け取られていない招待）。招待リンクの秘密は含めない */
export interface PendingInviteItem {
  email: string;
  role: string;
  stakeholderId: string | null;
  stakeholderName: string | null;
  invitedByUserId: string | null;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
}

export interface AccountAccessResponse {
  accounts: AccountAccessItem[];
  invites: PendingInviteItem[];
  generatedAt: string;
}
