'use server';

// パスワード再設定（メールの再設定リンク経由）の完了処理の Server Action。
//
// なぜサーバ側で行うか:
//   supabase/config.toml の auth.secure_password_change を有効にすると、GoTrue は
//   ブラウザからの auth.updateUser({ password }) を拒否する。再設定リンク経由のユーザーは
//   現在のパスワードを知らない（だから再設定する）ので再認証もできず、更新は
//   service_role の admin API（updateUserById）でしか行えない。
//
// 前提条件（すべて満たさなければ更新しない）:
//   1. Cookie セッションがあり、認証サービスがそのアクセストークンを受け付ける
//   2. そのセッションが「メールのリンクを踏んで、いま入ってきたもの」である
//      （アクセストークンの amr で確かめる。src/features/auth/utils/recoverySession.ts）。
//      これが本体の守り。パスワードでログインしただけのセッションでは、ここを通れない
//      （＝ログイン中のセッションを手に入れただけの人は、現在のパスワードなしに変えられない）。
//   3. openstock-pw-recovery マーカー Cookie がある（/auth/callback が張る。1 回の再設定で 1 度だけ使えるようにする
//      ための目印。Cookie はブラウザが好きな値を送れるので、これだけでは本人確認にならない）
//   ただログイン中の人が /reset-password を開いても proxy.ts で弾かれるが、Server Action は
//   URL を経由せず直接呼べるため、ここで独立に確かめる。
//
// 更新対象は必ず Cookie セッションのユーザー自身に固定する（入力の id 等は受け取らない）。

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditEventForUser } from '@/lib/audit/events';
import { toPasswordSaveErrorMessage, validateNewPassword } from '@/lib/security/passwordPolicy';
import type { ActionResult } from '@/types/actionResult';
import { RECOVERY_MARKER_COOKIE } from '@/features/auth/utils/passwordRecoveryCookie';
import { isRecentEmailLinkSession } from '@/features/auth/utils/recoverySession';

export const completePasswordRecovery = async (newPassword: string): Promise<ActionResult> => {
  const password = String(newPassword ?? '');
  // パスワードの決まり（src/lib/security/passwordPolicy.ts）
  const passwordError = validateNewPassword(password);
  if (passwordError) {
    return { ok: false, error: passwordError };
  }

  const cookieStore = await cookies();
  if (cookieStore.get(RECOVERY_MARKER_COOKIE)?.value !== '1') {
    return {
      ok: false,
      error: '再設定リンクの有効期限が切れています。ログイン画面から再度お試しください。',
    };
  }

  const expired: ActionResult = {
    ok: false,
    error: '再設定リンクの有効期限が切れています。ログイン画面から再度お試しください。',
  };

  // Cookie のセッションからアクセストークンを取り出し、認証サービスに渡して確かめる。
  // getSession() が返す user は Cookie の中身（ブラウザが書き換えられる）なので使わない。
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return expired;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser(accessToken);
  if (!user) {
    return expired;
  }
  // メールのリンクを踏んで入ってきたセッションだけを通す（認証サービスが受け付けた、その同じトークンで判定する）
  if (!isRecentEmailLinkSession(accessToken)) {
    await recordAuditEventForUser(user.id, {
      action: 'auth.password.reset',
      entityName: 'auth.users',
      entityId: user.id,
      detail: { reason: 'not_recovery_session' },
      outcome: 'denied',
    });
    return expired;
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password });
  if (error) {
    // 認証サービスが弱いパスワードとして拒否した場合は、決まりの文言を返す
    return { ok: false, error: toPasswordSaveErrorMessage(error, 'パスワードの更新に失敗しました') };
  }
  // パスワードそのものは残さない（再設定したという事実だけ）
  await recordAuditEventForUser(user.id, { action: 'auth.password.reset', entityName: 'auth.users', entityId: user.id }, admin);

  // マーカーは一度きり。更新が済んだら消して、同じ recovery セッションで再度
  // /reset-password を開いたり本 Action を呼び直したりできないようにする。
  cookieStore.delete(RECOVERY_MARKER_COOKIE);

  return { ok: true, data: undefined };
};
