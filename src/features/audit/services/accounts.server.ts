// アカウントの棚卸し（アクセス権の定期的な見直し）の一覧を作る（サーバ専用）。
//
// 呼び出し側（Route Handler）が requireAuditReader で権限を確かめてから呼ぶ。組織は profile.organizationId。
//   - アカウント: DB の関数 list_account_access（最後のログイン・二要素認証の登録数は auth スキーマから読む）
//   - 招待中: invites のうち、まだ受け取られていないもの。招待リンクの秘密（token）は読まない

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountAccessItem, AccountAccessResponse, PendingInviteItem } from '../types';
import { accountStatusOf, isInviteExpired } from './accessReview';

interface AccountRow {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  stakeholderId: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  mfaFactorCount: number | null;
  bannedUntil: string | null;
}

interface InviteRow {
  email: string;
  role: string;
  stakeholderId: string | null;
  invitedByUserId: string | null;
  createdAt: string;
  expiresAt: string;
}

export class AccountAccessError extends Error {
  constructor(message = 'アカウントの一覧の取得に失敗しました') {
    super(message);
    this.name = 'AccountAccessError';
  }
}

const stakeholderNamesOf = async (admin: SupabaseClient, organizationId: string, ids: string[]): Promise<Map<string, string>> => {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin.from('stakeholders').select('id, name').eq('organizationId', organizationId).in('id', ids);
  if (error) throw new AccountAccessError();
  return new Map(((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
};

export const listAccountAccess = async (
  admin: SupabaseClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<AccountAccessResponse> => {
  const [accountsResult, invitesResult] = await Promise.all([
    admin.rpc('list_account_access', { p_organization_id: organizationId }),
    admin
      .from('invites')
      // token（招待リンクの秘密）は選ばない
      .select('email, role, stakeholderId, invitedByUserId, createdAt, expiresAt')
      .eq('organizationId', organizationId)
      .is('acceptedAt', null)
      .order('createdAt', { ascending: true }),
  ]);
  if (accountsResult.error || invitesResult.error) throw new AccountAccessError();

  const accountRows = (accountsResult.data ?? []) as AccountRow[];
  const inviteRows = (invitesResult.data ?? []) as InviteRow[];

  const stakeholderIds = [
    ...new Set([...accountRows, ...inviteRows].map((row) => row.stakeholderId).filter((id): id is string => Boolean(id))),
  ];
  const stakeholderNames = await stakeholderNamesOf(admin, organizationId, stakeholderIds);
  const accountNames = new Map(accountRows.map((row) => [row.id, row.fullName?.trim() || row.email]));

  const accounts: AccountAccessItem[] = accountRows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.fullName?.trim() || null,
    role: row.role,
    stakeholderId: row.stakeholderId,
    stakeholderName: row.stakeholderId ? (stakeholderNames.get(row.stakeholderId) ?? null) : null,
    createdAt: row.createdAt,
    lastSignInAt: row.lastSignInAt,
    mfaFactorCount: Number(row.mfaFactorCount ?? 0),
    bannedUntil: row.bannedUntil,
    status: accountStatusOf(row, now),
  }));

  const invites: PendingInviteItem[] = inviteRows.map((row) => ({
    email: row.email,
    role: row.role,
    stakeholderId: row.stakeholderId,
    stakeholderName: row.stakeholderId ? (stakeholderNames.get(row.stakeholderId) ?? null) : null,
    invitedByUserId: row.invitedByUserId,
    invitedByName: row.invitedByUserId ? (accountNames.get(row.invitedByUserId) ?? null) : null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    isExpired: isInviteExpired(row.expiresAt, now),
  }));

  return { accounts, invites, generatedAt: now.toISOString() };
};
