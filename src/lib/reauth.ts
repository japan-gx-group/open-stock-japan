// 本人確認（ログインパスワードの再入力）の共通の処理（サーバ専用）。
// パスワード変更（src/features/settings/services/password.ts）と、AI の鍵の登録・削除
// （src/features/ai/services/aiCredentialActions.ts）で使う。
//
// ログインしていても、いま操作しているのが本人とは限らない（席を外した間の PC・盗まれたログイン状態）。
// 被害の大きい操作の前に、ログインパスワードをもう一度確かめる。本人確認をクライアントに任せない
// （ブラウザでの signInWithPassword の結果を信用しない）ため、必ずサーバで行う。
// 入力されたパスワードは保存しない・ログに出さない。
//
// 何度も試す攻撃への対策: 失敗は監査ログに残し、15 分のあいだに 5 回続いたら、その人の本人確認を 15 分止める
// （止めているあいだは、認証サービスを呼ばずに「正しくない」と返す）。ログイン中のセッションを手に入れただけの人が、
// この画面を使ってパスワードを総当たりできないようにする。数え方はログインの失敗と同じ決まり
// （src/features/auth/services/attemptLog.ts）で、ログインとは別に数える。

import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getReauthLockout, recordReauthFailure, resolveLoginTarget } from '@/features/auth/services/attemptLog';
import { logger } from '@/lib/logging/logger';
import { createAdminClient } from '@/lib/supabase/admin';

// 現在のパスワードが正しいかを signInWithPassword で検証する。
// Cookie セッション用のクライアント（@/lib/supabase/server）で呼ぶと、検証で発行された
// 新しいセッションが Cookie に書き戻されて操作者のセッションが差し替わってしまうため、
// セッションを永続化しない使い捨てクライアント（anon key）で行う。
const checkPassword = async (email: string, password: string): Promise<boolean> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;

  const throwaway = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await throwaway.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;

  // 検証用に発行したセッションはこのクライアントのメモリから捨てる（scope: 'local'。
  // 'global' にすると操作者本人のブラウザセッションまで失効する）。GoTrue 側のセッション行は
  // 有効期限で自然に消えるため、ここでは追加の失効処理をしない。失敗しても検証結果には影響しない。
  await throwaway.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return true;
};

/**
 * ログイン中の本人の、現在のパスワードが正しいか。
 * 失敗が続いて止めているあいだは、正しいパスワードでも false を返す（呼び出し側は「正しくない」として扱う）。
 */
export const verifyCurrentPassword = async (email: string, password: string): Promise<boolean> => {
  // 失敗の回数を数える相手（アカウントと組織）。決まらないとき・数えられないときは、回数の確認なしで続ける
  // （認証サービス側の回数の制限は、この場合も効く）
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let subject: { organizationId: string; userId: string } | null = null;
  let failuresBefore = 0;
  try {
    admin = createAdminClient();
    const target = await resolveLoginTarget(admin, email.trim().toLowerCase());
    if (target.userId && target.organizationId) {
      subject = { organizationId: target.organizationId, userId: target.userId };
      const status = await getReauthLockout(admin, subject);
      if (status.locked) return false;
      failuresBefore = status.failureCount;
    }
  } catch (error) {
    logger.error({ error }, '本人確認の失敗の回数を確かめられませんでした（回数の確認なしで続けます）');
    subject = null;
  }

  const valid = await checkPassword(email, password);
  if (!valid && admin && subject) {
    await recordReauthFailure(admin, subject, failuresBefore).catch((error: unknown) => {
      logger.error({ error }, '本人確認の失敗を記録できませんでした');
    });
  }
  return valid;
};
