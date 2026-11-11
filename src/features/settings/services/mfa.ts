'use server';

// 自分のアカウントの二要素認証（TOTP。認証アプリ）の登録・解除の Server Action。
// アカウント設定の「二要素認証」カードと、/mfa/setup（必須のときの登録・株主ロールの設定）から呼ぶ。全ロールが使える。
//
// サーバを通す理由（ブラウザから認証サービスを直接呼ばない）:
//   - 登録の完了（auth.mfa.enroll）とコードの誤り（auth.mfa.verify.failed）を、操作した人・接続元つきで監査ログに残す。
//     認証サービスが自分で残す記録は、登録の完了とログイン時の確認の区別が付かず、コードの誤りは残らない。
//   - コードの誤りが続いたら、確認を一時的に止める（attemptLog.ts）。
//   - 解除の前に、現在のパスワードで本人確認をする。組織が必須にしているときは、最後の 1 台を解除させない。
// 解除の成功は、認証サービスが残す（監査ログの auth.factor_unenrolled）ので、ここでは重ねて残さない。
//
// セッションの条件: ログインしていて、コードの確認待ち（challenge）でないこと。
//   必須なのに未登録（enroll）の人は getCurrentProfile() が null になるので、getSessionState 系を直接使う。
// TOTP の秘密の値（secret）とコードは、ログにも監査ログにも残さない。

import { readSessionState, type SessionState } from '@/lib/sessionState';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditEvent } from '@/lib/audit/events';
import { logger } from '@/lib/logging/logger';
import { verifyCurrentPassword } from '@/lib/reauth';
import type { ActionResult } from '@/types/actionResult';
import { isInternal } from '@/types/role';
import { createAuthServerClient } from '@/features/auth/services/authServerClient';
import { ensureMfaLockRecorded, getMfaLockout, recordMfaFailure } from '@/features/auth/services/attemptLog';
import { remainingLockMinutes } from '@/features/auth/utils/loginLockout';
import { MAX_MFA_FACTORS, MFA_MESSAGES, mfaLockedMessage, normalizeMfaCode } from '@/features/auth/utils/mfaCode';
import { verifiedFactors } from '@/features/auth/utils/mfaState';
import type { MfaEnrollment, MfaOverview } from './mfaTypes';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_FACTOR_NAME = '認証アプリ';
const MAX_FACTOR_NAME_LENGTH = 40;
// 認証アプリに表示される発行者の名前
const TOTP_ISSUER = 'OpenStock Japan';

type SignedInSession = SessionState & { user: NonNullable<SessionState['user']> };

// ログインしていて、コードの確認待ちでないセッションだけを通す
const requireUsableSession = async (): Promise<ActionResult<SignedInSession>> => {
  const session = await readSessionState();
  if (!session.user || session.mfa === 'challenge') {
    return { ok: false, error: MFA_MESSAGES.signedOut };
  }
  return { ok: true, data: session as SignedInSession };
};

const isRequiredFor = (session: SessionState): boolean =>
  session.requireMfaForInternal && isInternal(session.profile?.role ?? null);

/** 登録の状態（確認済みの機器の一覧と、必須かどうか） */
export const getMfaOverview = async (): Promise<ActionResult<MfaOverview>> => {
  const checked = await requireUsableSession();
  if (!checked.ok) return checked;
  const session = checked.data;
  return {
    ok: true,
    data: {
      factors: verifiedFactors(session.user.factors).map((factor) => ({
        id: factor.id,
        name: factor.friendly_name?.trim() || DEFAULT_FACTOR_NAME,
        createdAt: factor.created_at ?? null,
      })),
      required: isRequiredFor(session),
      maxFactors: MAX_MFA_FACTORS,
    },
  };
};

// 認証サービスが返す QR コードは、SVG をそのまま並べた data URL。SVG の中の「#」などで途中で切れないよう、
// 中身をエンコードし直す
const toSafeSvgDataUrl = (qrCode: string): string => {
  const comma = qrCode.indexOf(',');
  if (!qrCode.startsWith('data:image/svg+xml') || comma < 0) return qrCode;
  const svg = qrCode.slice(comma + 1);
  // すでにエンコード済みなら、そのまま返す
  if (!svg.trimStart().startsWith('<')) return qrCode;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

/**
 * 登録を始める。認証アプリに読ませる QR コードと秘密の値を返す（この時点では、まだ有効になっていない）。
 * 続けて confirmMfaEnrollment でコードを確認すると、登録が完了する。
 */
export const startMfaEnrollment = async (input: { name?: string } = {}): Promise<ActionResult<MfaEnrollment>> => {
  const checked = await requireUsableSession();
  if (!checked.ok) return checked;
  const session = checked.data;

  const verified = verifiedFactors(session.user.factors);
  if (verified.length >= MAX_MFA_FACTORS) {
    return { ok: false, error: `登録できる機器は${MAX_MFA_FACTORS}台までです。先に使わない機器を解除してください。` };
  }

  const supabase = await createAuthServerClient();

  // 途中でやめた登録（確認前の要素）が残っていたら、先に消す（同じ名前では登録できないため）
  for (const factor of session.user.factors) {
    if (factor.status === 'verified') continue;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) {
      logger.warn({ code: error.code }, '確認前の二要素認証の要素を消せませんでした');
    }
  }

  // 機器の名前。同じ名前は付けられないので、重なったら番号を足す
  const requested = typeof input?.name === 'string' ? input.name.trim().slice(0, MAX_FACTOR_NAME_LENGTH) : '';
  const usedNames = new Set(verified.map((factor) => factor.friendly_name?.trim() ?? ''));
  let friendlyName = requested || DEFAULT_FACTOR_NAME;
  for (let suffix = 2; usedNames.has(friendlyName); suffix += 1) {
    friendlyName = `${requested || DEFAULT_FACTOR_NAME} ${suffix}`;
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName, issuer: TOTP_ISSUER });
  if (error || !data || data.type !== 'totp') {
    logger.warn({ code: error?.code, status: error?.status }, '二要素認証の登録を始められませんでした');
    return { ok: false, error: '二要素認証の登録を始められませんでした。時間をおいて再度お試しください。' };
  }

  return {
    ok: true,
    data: { factorId: data.id, qrCode: toSafeSvgDataUrl(data.totp.qr_code), secret: data.totp.secret },
  };
};

/** 認証アプリに表示されたコードを確かめて、登録を完了する */
export const confirmMfaEnrollment = async (input: { factorId: string; code: string }): Promise<ActionResult> => {
  const factorId = typeof input?.factorId === 'string' ? input.factorId : '';
  if (!UUID_PATTERN.test(factorId)) {
    return { ok: false, error: '登録の情報が正しくありません。最初からやり直してください。' };
  }
  const code = normalizeMfaCode(input?.code);
  if (!code) {
    return { ok: false, error: MFA_MESSAGES.invalidFormat };
  }

  const checked = await requireUsableSession();
  if (!checked.ok) return checked;
  const session = checked.data;

  // 自分の、確認前の要素であること
  const factor = session.user.factors.find((candidate) => candidate.id === factorId);
  if (!factor || factor.status === 'verified') {
    return { ok: false, error: '登録の有効期限が切れました。最初からやり直してください。' };
  }

  const subject = session.profile
    ? { organizationId: session.profile.organizationId, userId: session.user.id }
    : null;
  const admin = subject ? createAdminClient() : null;

  const before = subject && admin ? await getMfaLockout(admin, subject) : null;
  if (subject && admin && before?.locked && before.lockedUntil !== null) {
    await ensureMfaLockRecorded(admin, subject, before);
    return { ok: false, error: mfaLockedMessage(remainingLockMinutes(before.lockedUntil, Date.now())) };
  }

  const supabase = await createAuthServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    if (error.code !== 'mfa_verification_failed') {
      logger.warn({ code: error.code, status: error.status }, '二要素認証の登録のコードを確認できませんでした（コードの誤り以外）');
      return { ok: false, error: MFA_MESSAGES.serviceError };
    }
    if (subject && admin) {
      const after = await recordMfaFailure(admin, subject, 'enroll', before?.failureCount ?? 0);
      if (after.locked && after.lockedUntil !== null) {
        return { ok: false, error: mfaLockedMessage(remainingLockMinutes(after.lockedUntil, Date.now())) };
      }
    }
    return { ok: false, error: MFA_MESSAGES.wrongCode };
  }

  // 登録が完了した（このセッションは aal2 になり、新しいトークンが Cookie に書かれている）
  if (subject && admin) {
    await recordAuditEvent(
      subject,
      {
        action: 'auth.mfa.enroll',
        entityName: 'auth.users',
        entityId: session.user.id,
        detail: {
          factorId,
          name: factor.friendly_name ?? null,
          factorCount: verifiedFactors(session.user.factors).length + 1,
        },
      },
      admin,
    );
  }
  return { ok: true, data: undefined };
};

/** 登録を途中でやめる（確認前の要素を消す）。確認済みの要素は消さない */
export const cancelMfaEnrollment = async (input: { factorId: string }): Promise<ActionResult> => {
  const factorId = typeof input?.factorId === 'string' ? input.factorId : '';
  const checked = await requireUsableSession();
  if (!checked.ok) return checked;
  const factor = checked.data.user.factors.find((candidate) => candidate.id === factorId);
  if (!factor || factor.status === 'verified') {
    return { ok: true, data: undefined };
  }
  const supabase = await createAuthServerClient();
  await supabase.auth.mfa.unenroll({ factorId });
  return { ok: true, data: undefined };
};

/** 登録してある機器を解除する。現在のパスワードで本人確認をしてから行う */
export const removeMfaFactor = async (input: { factorId: string; currentPassword: string }): Promise<ActionResult> => {
  const factorId = typeof input?.factorId === 'string' ? input.factorId : '';
  const currentPassword = typeof input?.currentPassword === 'string' ? input.currentPassword : '';
  if (!UUID_PATTERN.test(factorId)) {
    return { ok: false, error: '解除する機器が見つかりません。' };
  }
  if (!currentPassword) {
    return { ok: false, error: '現在のパスワードを入力してください' };
  }

  const session = await readSessionState();
  // 解除は、コードを確認済みのセッション（mfa = 'ok'）からだけ
  if (!session.user || session.mfa !== 'ok' || !session.user.email) {
    return { ok: false, error: MFA_MESSAGES.signedOut };
  }

  const verified = verifiedFactors(session.user.factors);
  const factor = verified.find((candidate) => candidate.id === factorId);
  if (!factor) {
    return { ok: false, error: '解除する機器が見つかりません。' };
  }
  if (isRequiredFor(session) && verified.length <= 1) {
    return {
      ok: false,
      error: '組織の設定で二要素認証が必須のため、最後の1台は解除できません。機器を替えるときは、先に新しい機器を追加してください。',
    };
  }

  const subject = session.profile
    ? { organizationId: session.profile.organizationId, userId: session.user.id }
    : null;

  if (!(await verifyCurrentPassword(session.user.email, currentPassword))) {
    if (subject) {
      await recordAuditEvent(subject, {
        action: 'auth.mfa.unenroll',
        entityName: 'auth.users',
        entityId: session.user.id,
        detail: { reason: 'current_password_mismatch', factorId },
        outcome: 'failure',
      });
    }
    return { ok: false, error: '現在のパスワードが正しくありません' };
  }

  const supabase = await createAuthServerClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    logger.warn({ code: error.code, status: error.status }, '二要素認証の解除に失敗しました');
    return { ok: false, error: '二要素認証の解除に失敗しました。時間をおいて再度お試しください。' };
  }

  // 認証サービスは、要素を解除するとその人のセッションをすべて aal1 に戻す。手元のトークンは期限（1 時間）まで
  // aal2 のままなので、ここで取り直して実際の状態にそろえる。ほかの機器が残っていれば、次の操作で
  // その機器のコードを求められる（残した機器が手元にあることの確認にもなる）。失敗しても解除は済んでいる
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    logger.warn({ code: refreshError.code }, '二要素認証の解除のあと、セッションを取り直せませんでした');
  }
  return { ok: true, data: undefined };
};
