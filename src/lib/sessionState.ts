// いまのリクエストのセッションの状態（だれか・プロフィール・二要素認証の状態）をサーバで読む共通ヘルパー。
//
//   - 権限の要る処理は、これまでどおり getCurrentProfile()（src/lib/currentProfile.ts）と
//     src/lib/authz.ts の requireAdmin / requireEditor / requireInternal を使う。getCurrentProfile() は
//     この関数の結果のうち、二要素認証の状態が 'ok' のときだけプロフィールを返す（それ以外は null = 401）。
//   - この関数を直接使うのは、「ログインはしているが、二要素認証がまだ」の人を扱うところだけ:
//     レイアウトの振り分け（/mfa・/mfa/setup へ送る）、/mfa の画面、コードを確認する Server Action。
//
// 判定に使う値は、ブラウザが書き換えられないものだけにする。
//   だれか・要素の一覧 … 認証サービス（Supabase Auth）に、Cookie のアクセストークンを渡して取り直す（auth.getUser(token)）
//   aal               … 認証サービスが受け付けた、その同じトークンの中身から読む
//                        （確かめる前のトークンや、ブラウザから送られた値は使わない）
//   ロール・組織の設定 … DB から service_role で読む（「まだ」の状態の人は、RLS で自分のプロフィールも読めないため）
//
// ⚠️ サーバ専用: cookies() と service_role を使うため Client Component から import しないこと。

import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logging/logger';
import { readAuditRequestContext } from '@/lib/audit/requestContext';
import { isMemberRole } from '@/types/role';
import {
  decideMfaState,
  mfaRedirectUrl,
  readAalFromAccessToken,
  verifiedFactors,
  type AssuranceLevel,
  type MfaFactorLike,
  type MfaState,
} from '@/features/auth/utils/mfaState';
import type { CurrentProfile } from '@/lib/currentProfile';

export interface SessionUser {
  id: string;
  email: string | null;
  /** セッションの保証レベル（aal2 = コードを確認済み） */
  aal: AssuranceLevel | null;
  /** 登録してある要素（確認前のものを含む）。認証サービスから取り直した値 */
  factors: MfaFactorLike[];
}

export interface SessionState {
  /** ログインしている本人。未ログインなら null */
  user: SessionUser | null;
  /** プロフィール（ロール・所属）。二要素認証が済んでいなくても返す。権限の判定には getCurrentProfile() を使うこと */
  profile: CurrentProfile | null;
  mfa: MfaState;
  /** 組織の設定: 社内のアカウントに二要素認証を必須にしている */
  requireMfaForInternal: boolean;
}

const SIGNED_OUT: SessionState = { user: null, profile: null, mfa: 'ok', requireMfaForInternal: false };

interface ProfileRow {
  id: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  role: unknown;
  stakeholderId: string | null;
  // supabase-js は生成型なしだと埋め込みを配列として推論するため、どちらの形でも受ける
  organizations: { requireMfaForInternal: boolean | null } | { requireMfaForInternal: boolean | null }[] | null;
}

const loadProfile = async (
  userId: string,
): Promise<{ profile: CurrentProfile | null; requireMfaForInternal: boolean }> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, organizationId, email, fullName, role, stakeholderId, organizations(requireMfaForInternal)')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    // 列が無い（マイグレーションの当て忘れ）・接続できないなど。権限なし（401）に倒し、原因はログに残す
    logger.error({ error }, 'プロフィールの取得に失敗しました（マイグレーションと接続設定を確認してください）');
    return { profile: null, requireMfaForInternal: false };
  }
  if (!data) return { profile: null, requireMfaForInternal: false };

  const row = data as ProfileRow;
  const organization = Array.isArray(row.organizations) ? (row.organizations[0] ?? null) : row.organizations;
  const requireMfaForInternal = organization?.requireMfaForInternal === true;
  // DB の check 制約で限定されているが、想定外の値は安全側（権限なし扱い）に倒す。
  if (!isMemberRole(row.role)) return { profile: null, requireMfaForInternal };

  return {
    profile: {
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      fullName: row.fullName ?? null,
      role: row.role,
      stakeholderId: row.stakeholderId ?? null,
    },
    requireMfaForInternal,
  };
};

/**
 * セッションの状態を読む（メモ化なし）。同じリクエストの中でセッションを変えたあと
 * （コードの確認の直後など）に読み直すときに使う。ふつうは getSessionState() を使うこと。
 */
export const readSessionState = async (): Promise<SessionState> => {
  const supabase = await createClient();

  // Cookie のセッションからアクセストークンを取り出す（期限切れなら更新される）。
  // ここで得られる session.user はブラウザから来た Cookie の中身なので使わない。使うのはトークンだけ。
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return SIGNED_OUT;

  // トークンを認証サービスに渡して確かめ、本人と要素の一覧を取り直す。
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) return SIGNED_OUT;

  // aal は、いま認証サービスが受け付けた、その同じトークンから読む。
  const aal = readAalFromAccessToken(accessToken);
  const factors: MfaFactorLike[] = (user.factors ?? []).map((factor) => ({
    id: factor.id,
    status: factor.status,
    factor_type: factor.factor_type,
    friendly_name: factor.friendly_name ?? null,
    created_at: factor.created_at,
  }));
  const sessionUser: SessionUser = { id: user.id, email: user.email ?? null, aal, factors };

  let loaded: Awaited<ReturnType<typeof loadProfile>>;
  try {
    loaded = await loadProfile(user.id);
  } catch (loadError) {
    logger.error({ error: loadError }, 'プロフィールの取得に失敗しました（SUPABASE_SERVICE_ROLE_KEY を確認してください）');
    loaded = { profile: null, requireMfaForInternal: false };
  }

  const mfa = decideMfaState({
    verifiedFactorCount: verifiedFactors(factors).length,
    aal,
    role: loaded.profile?.role ?? null,
    requireMfaForInternal: loaded.requireMfaForInternal,
  });

  return { user: sessionUser, profile: loaded.profile, mfa, requireMfaForInternal: loaded.requireMfaForInternal };
};

// React の cache() でリクエスト単位にメモ化する（同じリクエストの中で何度呼んでも、認証サービスと DB への往復は 1 回）。
export const getSessionState = cache(readSessionState);

/**
 * 二要素認証がまだの人を送る先（/mfa か /mfa/setup）。済んでいれば null。
 * レイアウト（src/app/(app)/layout.tsx・src/app/(external-portal)/layout.tsx）が redirect() に渡す。
 * 元の行き先は、プロキシが入れたリクエストのパス（クエリは含まない）から引き継ぐ。
 */
export const getMfaRedirect = async (state: SessionState): Promise<string | null> => {
  if (!state.user || state.mfa === 'ok') return null;
  const { route } = await readAuditRequestContext();
  // route は「GET /shareholders」の形。画面の表示（GET）のときだけ、そのパスへ戻す
  const match = route?.match(/^GET (\/\S*)$/);
  return mfaRedirectUrl(state.mfa, match?.[1] ?? null);
};
