'use server';

// ログイン中ユーザーのパスワード変更の Server Action（設定＞アカウント）。
//
// なぜサーバ側で行うか:
//   supabase/config.toml の auth.secure_password_change を有効にすると、GoTrue は
//   ブラウザからの auth.updateUser({ password })（再認証 nonce 無し）を拒否する。
//   そのため「現在のパスワードの検証」と「新パスワードの反映」をどちらもサーバで行い、
//   反映は service_role の admin API（updateUserById）で行う。
//   本人確認をクライアントに任せない（signInWithPassword の結果を信用しない）ため、
//   一時的にセッションを奪われた状態で勝手にパスワードを変えられることも防げる。
//
// service_role は RLS も認証も越えるため、更新対象は必ず Cookie セッションのユーザー自身に固定する。
// 二要素認証が済んでいないセッション（パスワードだけを知っている人）からは変更させない
// （getSessionState の mfa が 'ok' のときだけ進める）。

import { getSessionState } from '@/lib/sessionState';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditEventForUser } from '@/lib/audit/events';
import { toPasswordSaveErrorMessage, validateNewPassword } from '@/lib/security/passwordPolicy';
// 現在のパスワードの検証（使い捨てのクライアントで signInWithPassword）は、AI の鍵の登録と共通の処理にした。
import { verifyCurrentPassword } from '@/lib/reauth';
import type { ActionResult } from '@/types/actionResult';

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export const changePassword = async (input: ChangePasswordInput): Promise<ActionResult> => {
  const currentPassword = String(input.currentPassword ?? '');
  const newPassword = String(input.newPassword ?? '');

  if (!currentPassword) {
    return { ok: false, error: '現在のパスワードを入力してください' };
  }
  // パスワードの決まり（src/lib/security/passwordPolicy.ts）。画面でも確かめるが、Server Action は直接呼べる
  const passwordError = validateNewPassword(newPassword);
  if (passwordError) {
    return { ok: false, error: passwordError };
  }

  // 1) 更新対象は Cookie セッションのユーザー本人に固定する（入力の id 等は一切受け取らない）。
  //    二要素認証がまだのセッションは、ログインしていない扱いにする。
  const session = await getSessionState();
  const user = session.mfa === 'ok' ? session.user : null;
  if (!user?.email) {
    return { ok: false, error: 'ログイン情報が確認できませんでした。再度ログインしてください' };
  }

  // 2) 現在のパスワードで本人確認する。
  if (!(await verifyCurrentPassword(user.email, currentPassword))) {
    await recordAuditEventForUser(user.id, {
      action: 'auth.password.change',
      entityName: 'auth.users',
      entityId: user.id,
      detail: { reason: 'current_password_mismatch' },
      outcome: 'failure',
    });
    return { ok: false, error: '現在のパスワードが正しくありません' };
  }

  // 3) 新パスワードを反映する（secure_password_change の制約を受けない admin API 経由）。
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) {
    // 認証サービスが弱いパスワードとして拒否した場合は、決まりの文言を返す
    return { ok: false, error: toPasswordSaveErrorMessage(error, 'パスワードの更新に失敗しました') };
  }
  // パスワードそのものは残さない（変えたという事実だけ）
  await recordAuditEventForUser(user.id, { action: 'auth.password.change', entityName: 'auth.users', entityId: user.id }, admin);

  return { ok: true, data: undefined };
};
