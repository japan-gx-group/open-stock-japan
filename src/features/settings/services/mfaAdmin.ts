'use server';

// 組織の二要素認証の設定と、メンバーの二要素認証のリセット（管理者の操作）の Server Action。
//
//   getSecurityPolicy          「セキュリティ」カードの表示（社内の全員が読める。変えられるのは管理者だけ）
//   setRequireMfaForInternal   社内のアカウントに二要素認証を必須にする / やめる（管理者だけ）
//   getMembersMfaStatus        メンバーごとの、二要素認証の登録の有無（管理者だけ。メンバー一覧の「リセット」ボタン用）
//   resetMemberMfa             機器をなくしたメンバーの二要素認証をリセットする（管理者だけ。自分には使えない）
//
// 権限は必ずサーバで確かめる（requireAdmin / requireInternal。二要素認証が済んでいないセッションは通らない）。
// 設定の列（organizations.requireMfaForInternal）は authenticated の列 GRANT に無いので、service_role で更新する。
// 更新は organizations の行のトリガーが、変更前後の値つきで監査ログに残す（organizations.update）。
// リセットは auth.mfa.reset として残す（対象 = リセットされたメンバー）。

import { requireAdmin, requireInternal } from '@/lib/authz';
import { getSessionState } from '@/lib/sessionState';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditEvent } from '@/lib/audit/events';
import { logger } from '@/lib/logging/logger';
import type { ActionResult } from '@/types/actionResult';
import { isAdmin, isInternal, isMemberRole } from '@/types/role';
import { verifiedFactors } from '@/features/auth/utils/mfaState';
import type { SecurityPolicy } from './mfaTypes';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AccountAccessRow {
  id: string;
  role: string;
  mfaFactorCount: number | null;
}

type AdminClient = ReturnType<typeof createAdminClient>;

// アカウントごとの、確認済みの要素の数（auth スキーマは PostgREST から読めないので、DB の関数 list_account_access を使う）
const loadAccountAccess = async (admin: AdminClient, organizationId: string): Promise<AccountAccessRow[] | null> => {
  const { data, error } = await admin.rpc('list_account_access', { p_organization_id: organizationId });
  if (error) {
    logger.error({ error }, 'アカウントの二要素認証の状態を取得できませんでした');
    return null;
  }
  return (data as AccountAccessRow[] | null) ?? [];
};

export const getSecurityPolicy = async (): Promise<ActionResult<SecurityPolicy>> => {
  const check = await requireInternal();
  if (!check.ok) return { ok: false, error: check.error };
  const { profile } = check;

  const session = await getSessionState();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('organizations')
    .select('requireMfaForInternal')
    .eq('id', profile.organizationId)
    .single();
  if (error || !data) {
    return { ok: false, error: 'セキュリティの設定を取得できませんでした' };
  }

  // 登録済みの人数は、管理者にだけ返す（必須にしたときに、だれが登録を求められるかの目安）
  let internalMfaCount: SecurityPolicy['internalMfaCount'] = null;
  if (isAdmin(profile.role)) {
    const rows = await loadAccountAccess(admin, profile.organizationId);
    if (rows) {
      const internal = rows.filter((row) => isMemberRole(row.role) && isInternal(row.role));
      internalMfaCount = {
        enrolled: internal.filter((row) => (row.mfaFactorCount ?? 0) > 0).length,
        total: internal.length,
      };
    }
  }

  return {
    ok: true,
    data: {
      requireMfaForInternal: (data as { requireMfaForInternal: boolean }).requireMfaForInternal === true,
      canEdit: isAdmin(profile.role),
      viewerHasMfa: verifiedFactors(session.user?.factors).length > 0,
      internalMfaCount,
    },
  };
};

export const setRequireMfaForInternal = async (enabled: boolean): Promise<ActionResult<{ requireMfaForInternal: boolean }>> => {
  if (typeof enabled !== 'boolean') {
    return { ok: false, error: '設定の値が正しくありません' };
  }
  const check = await requireAdmin();
  if (!check.ok) return { ok: false, error: check.error };
  const { profile } = check;

  // 必須にする前に、操作している管理者自身が登録を済ませていること。
  // 済ませていないと、有効にした直後から自分も登録を求められ、認証アプリの用意が無いと先へ進めなくなる。
  if (enabled) {
    const session = await getSessionState();
    if (verifiedFactors(session.user?.factors).length === 0) {
      return {
        ok: false,
        error: '先に、ご自身の二要素認証を登録してください（アカウント設定 > 二要素認証）。登録が済むと、必須にできます。',
      };
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('organizations')
    .update({ requireMfaForInternal: enabled })
    .eq('id', profile.organizationId)
    .select('requireMfaForInternal')
    .single();
  if (error || !data) {
    logger.error({ error }, '二要素認証の必須の設定を保存できませんでした');
    return { ok: false, error: '設定の保存に失敗しました' };
  }
  return { ok: true, data: { requireMfaForInternal: (data as { requireMfaForInternal: boolean }).requireMfaForInternal === true } };
};

/** メンバーの id → 二要素認証を登録済みか。管理者だけが読める */
export const getMembersMfaStatus = async (): Promise<ActionResult<Record<string, boolean>>> => {
  const check = await requireAdmin();
  if (!check.ok) return { ok: false, error: check.error };

  const rows = await loadAccountAccess(createAdminClient(), check.profile.organizationId);
  if (!rows) {
    return { ok: false, error: '二要素認証の状態を取得できませんでした' };
  }
  return { ok: true, data: Object.fromEntries(rows.map((row) => [row.id, (row.mfaFactorCount ?? 0) > 0])) };
};

/**
 * メンバーの二要素認証をリセットする（登録してある機器をすべて消す）。
 * 機器をなくした・替えたメンバーが、パスワードだけでログインし直せるようにするための管理者の操作。
 * 組織が必須にしていれば、そのメンバーは次にログインしたときに登録し直しを求められる。
 */
export const resetMemberMfa = async (memberId: string): Promise<ActionResult<{ removed: number }>> => {
  if (typeof memberId !== 'string' || !UUID_PATTERN.test(memberId)) {
    return { ok: false, error: '対象のメンバーが見つかりません' };
  }
  const check = await requireAdmin();
  if (!check.ok) return { ok: false, error: check.error };
  const { profile } = check;

  // 自分のリセットはできない（自分の機器は、アカウント設定から本人確認のうえで解除する）
  if (memberId === profile.id) {
    return { ok: false, error: '自分の二要素認証は、アカウント設定から解除してください' };
  }

  const admin = createAdminClient();
  // 対象は自組織のアカウントだけ（service_role は RLS が効かないので、必ず組織で絞る）
  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, email, role')
    .eq('id', memberId)
    .eq('organizationId', profile.organizationId)
    .maybeSingle();
  if (targetError || !target) {
    return { ok: false, error: '対象のメンバーが見つかりません' };
  }

  const { data: listed, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: memberId });
  if (listError || !listed) {
    logger.error({ error: listError }, 'メンバーの二要素認証の要素を取得できませんでした');
    return { ok: false, error: '二要素認証のリセットに失敗しました' };
  }

  const factors = listed.factors ?? [];
  let removed = 0;
  let verifiedRemoved = 0;
  for (const factor of factors) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: memberId });
    if (error) {
      logger.error({ error }, 'メンバーの二要素認証の要素を消せませんでした');
      continue;
    }
    removed += 1;
    if (factor.status === 'verified') verifiedRemoved += 1;
  }
  const failed = factors.length - removed;

  // 消したものが 1 つでもあれば残す（途中で失敗した場合も、消した分は記録する）
  if (removed > 0 || factors.length === 0) {
    await recordAuditEvent(
      { organizationId: profile.organizationId, userId: profile.id },
      {
        action: 'auth.mfa.reset',
        entityName: 'auth.users',
        entityId: memberId,
        detail: {
          targetEmail: (target as { email: string }).email,
          targetRole: (target as { role: string }).role,
          removedFactors: removed,
          removedVerifiedFactors: verifiedRemoved,
          ...(failed > 0 ? { failedFactors: failed } : {}),
        },
        ...(failed > 0 ? { outcome: 'failure' as const } : {}),
      },
      admin,
    );
  }

  if (failed > 0) {
    return { ok: false, error: '一部の機器を解除できませんでした。もう一度お試しください。' };
  }
  return { ok: true, data: { removed } };
};
