// 株主ポータルの利用状況（権利者ごと）の判定。サーバ依存なし。
//   none    … 招待していない
//   invited … 招待済み（アカウント未作成）。期限が切れていれば isExpired
//   active  … アカウント作成済み（株主ロールのプロフィールが権利者に紐づいている）

export type PortalAccessStatus = 'none' | 'invited' | 'active';

export interface PortalAccessEntry {
  status: PortalAccessStatus;
  /** 招待した日時（invited）／アカウントを作った日時（active） */
  invitedAt?: string;
  /** 招待リンクの期限（invited のとき） */
  expiresAt?: string;
  /** 招待リンクの期限が切れている（invited のとき） */
  isExpired?: boolean;
  /** 招待リンク。管理者にだけ返す（invited で期限内のとき） */
  inviteUrl?: string;
}

export type PortalAccessMap = Record<string, PortalAccessEntry>;

export interface LinkedProfileRow {
  stakeholderId: string | null;
  role: string;
  createdAt?: string | null;
}

export interface PendingInviteRow {
  stakeholderId: string | null;
  role: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/**
 * 権利者ごとの利用状況を作る。
 * - アカウント（株主ロールで権利者に紐づくプロフィール）があれば active（招待が残っていても active を優先）。
 * - 未受諾の株主あての招待があれば invited（複数あれば新しいもの）。
 * - buildInviteUrl を渡したとき（管理者）だけ、期限内の招待にリンクを付ける。
 */
export const buildPortalAccessMap = (
  stakeholderIds: readonly string[],
  profiles: readonly LinkedProfileRow[],
  invites: readonly PendingInviteRow[],
  now: Date = new Date(),
  buildInviteUrl?: (token: string) => string | null,
): PortalAccessMap => {
  const map: PortalAccessMap = {};
  for (const id of stakeholderIds) map[id] = { status: 'none' };

  const pending = invites
    .filter((invite) => invite.role === 'shareholder' && invite.stakeholderId != null && invite.acceptedAt == null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const invite of pending) {
    const id = invite.stakeholderId as string;
    if (!(id in map)) continue;
    const expires = new Date(invite.expiresAt).getTime();
    const isExpired = !(Number.isFinite(expires) && expires >= now.getTime());
    const inviteUrl = !isExpired && buildInviteUrl ? buildInviteUrl(invite.token) : null;
    map[id] = {
      status: 'invited',
      invitedAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      isExpired,
      ...(inviteUrl ? { inviteUrl } : {}),
    };
  }

  for (const profile of profiles) {
    if (profile.role !== 'shareholder' || profile.stakeholderId == null || !(profile.stakeholderId in map)) continue;
    map[profile.stakeholderId] = { status: 'active', ...(profile.createdAt ? { invitedAt: profile.createdAt } : {}) };
  }
  return map;
};
