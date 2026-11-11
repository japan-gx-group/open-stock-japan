'use server';

// ログイン時の二要素認証（TOTP）のコードの確認（/mfa の画面から呼ぶ Server Action）。
//
// なぜサーバで行うか:
//   ブラウザから認証サービスを直接呼ぶ形だと、コードの誤りがどこにも残らない
//   （認証サービスが自分で残すのは、確認に成功したときの記録だけ）。サーバを通して、
//   失敗を監査ログに残し、失敗が続いたら確認を一時的に止める（15 分に 5 回まで。attemptLog.ts）。
//
// 対象は「パスワードは通ったが、コードの確認がまだ」のセッション（getSessionState の mfa = 'challenge'）。
// 確認に成功すると、認証サービスがセッションを aal2 に上げ、その新しいトークンを Cookie に書く。
// 登録してある機器が複数あるとき（予備の機器）は、どの機器のコードでも通るように順に確かめる。
// コードそのものは、ログにも監査ログにも残さない。

import { readSessionState } from '@/lib/sessionState';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logging/logger';
import type { ActionResult } from '@/types/actionResult';
import { createAuthServerClient } from '@/features/auth/services/authServerClient';
import { ensureMfaLockRecorded, getMfaLockout, recordMfaFailure } from '@/features/auth/services/attemptLog';
import { remainingLockMinutes } from '@/features/auth/utils/loginLockout';
import { MFA_MESSAGES, mfaLockedMessage, normalizeMfaCode } from '@/features/auth/utils/mfaCode';
import { verifiedFactors } from '@/features/auth/utils/mfaState';

export const verifyMfaChallenge = async (input: { code: string }): Promise<ActionResult> => {
  const code = normalizeMfaCode(input?.code);
  if (!code) {
    return { ok: false, error: MFA_MESSAGES.invalidFormat };
  }

  const session = await readSessionState();
  if (!session.user) {
    return { ok: false, error: MFA_MESSAGES.signedOut };
  }
  // もう確認済み（別のタブで済ませた場合など）
  if (session.mfa === 'ok') {
    return { ok: true, data: undefined };
  }
  const factors = verifiedFactors(session.user.factors).filter((factor) => factor.factor_type === 'totp');
  if (session.mfa !== 'challenge' || factors.length === 0) {
    return { ok: false, error: '二要素認証が登録されていません。先に登録してください。' };
  }

  // 監査ログの記録先（プロフィールが無いアカウントは記録先が無いので、確認だけ行う）
  const subject = session.profile
    ? { organizationId: session.profile.organizationId, userId: session.user.id }
    : null;
  const admin = subject ? createAdminClient() : null;

  // 止めているあいだは、認証サービスに問い合わせない（失敗としても数えない）
  const before = subject && admin ? await getMfaLockout(admin, subject) : null;
  if (subject && admin && before?.locked && before.lockedUntil !== null) {
    await ensureMfaLockRecorded(admin, subject, before);
    return { ok: false, error: mfaLockedMessage(remainingLockMinutes(before.lockedUntil, Date.now())) };
  }

  const supabase = await createAuthServerClient();
  for (const factor of factors) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (!error) {
      // 成功の記録は、認証サービスが残す（監査ログの auth.verification_attempted）
      return { ok: true, data: undefined };
    }
    if (error.code !== 'mfa_verification_failed') {
      // コードの誤り以外（認証サービスの回数制限・通信の失敗など）。失敗には数えない
      logger.warn({ code: error.code, status: error.status }, '二要素認証のコードを確認できませんでした（コードの誤り以外）');
      return { ok: false, error: MFA_MESSAGES.serviceError };
    }
  }

  if (subject && admin) {
    const after = await recordMfaFailure(admin, subject, 'login', before?.failureCount ?? 0);
    if (after.locked && after.lockedUntil !== null) {
      return { ok: false, error: mfaLockedMessage(remainingLockMinutes(after.lockedUntil, Date.now())) };
    }
  }
  return { ok: false, error: MFA_MESSAGES.wrongCode };
};
