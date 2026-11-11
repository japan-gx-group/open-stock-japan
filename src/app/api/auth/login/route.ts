// ログイン（POST /api/auth/login）。メールアドレスとパスワードを受け取り、サーバから認証サービスへ問い合わせる。
//
// ブラウザから認証サービスを直接呼ぶ形（supabase.auth.signInWithPassword）だと、失敗した試行がどこにも残らず、
// 連続した失敗を止めることもできない。そこで、ログインはこの API を通す。
//
//   - 送り元（Origin）がこのサイト自身であることを確かめる（未ログインで呼べる唯一の API。src/proxy.ts）。
//   - 失敗は監査ログに auth.login.failed として残す（パスワードは残さない）。
//     成功は、DB のトリガーが auth.login として残す（ここでは残さない）。
//   - 同じメールアドレスで 15 分に 5 回失敗すると、15 分間はそのメールアドレスでのログインを受け付けない
//     （認証サービスには問い合わせない）。止めたことは auth.login.locked として 1 回だけ残す。
//     回数は監査ログから数える（src/features/auth/services/attemptLog.ts）。
//   - メールアドレスがアカウントのものかどうかは、応答から分からないようにする
//     （存在しないメールアドレスでも、パスワードの誤りと同じ文言・同じ止め方）。
//   - 成功すると、セッションの Cookie を応答に付ける。二要素認証が要る人には、次に開く画面（mfa）を伝える。
//     伝えるのは案内のためだけで、強制はサーバ（getCurrentProfile）と DB（RLS）が行う。
//
// 限界: 認証サービスの API は、ブラウザに配っている公開鍵（anon key）で直接呼べる。この API を通さずに
// 直接呼ばれた失敗は、ここでは数えられない。そちらは認証サービス側の回数制限（接続元ごと）と、
// 必要なら CAPTCHA・パスワード検証フックで守る（docs に記載）。

import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditContextFromHeaders } from '@/lib/audit/headers';
import { isValidEmail } from '@/lib/email';
import { logger } from '@/lib/logging/logger';
import { isSameOriginRequest } from '@/lib/security/origin';
import { isMemberRole } from '@/types/role';
import { createAuthServerClient } from '@/features/auth/services/authServerClient';
import {
  CREDENTIAL_FAILURE_REASON,
  ensureLoginLockRecorded,
  getLoginLockout,
  recordLoginFailure,
  resolveLoginTarget,
  type LoginFailureReason,
} from '@/features/auth/services/attemptLog';
import { LOGIN_ERROR_MESSAGES, loginLockedMessage, toLoginErrorMessage } from '@/features/auth/services/loginErrorMessage';
import { loginFailureThrottle } from '@/features/auth/services/loginThrottle';
import { remainingLockMinutes } from '@/features/auth/utils/loginLockout';
import { decideMfaState, verifiedFactors } from '@/features/auth/utils/mfaState';

// service_role と Cookie を使うため Node ランタイムで実行する。
export const runtime = 'nodejs';

// 本文の上限。メールアドレスとパスワードだけなので小さくてよい
const MAX_BODY_BYTES = 4096;
const MAX_EMAIL_LENGTH = 254;
// パスワードの長さはここでは確かめない（決まりより前に作られたアカウントがある）。極端に長い入力だけ弾く
const MAX_PASSWORD_LENGTH = 1024;

const noStore = { 'Cache-Control': 'no-store' };

const failure = (error: string, status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  NextResponse.json({ ok: false, error, ...extra }, { status, headers: { ...noStore, ...headers } });

const lockedResponse = (lockedUntil: number, now: number) => {
  const seconds = Math.max(1, Math.ceil((lockedUntil - now) / 1000));
  return failure(loginLockedMessage(remainingLockMinutes(lockedUntil, now)), 429, { code: 'locked' }, { 'Retry-After': String(seconds) });
};

const readCredentials = async (request: NextRequest): Promise<{ email: string; password: string } | null> => {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) return null;
  if (normalizedEmail.length > MAX_EMAIL_LENGTH || password.length > MAX_PASSWORD_LENGTH) return null;
  return { email: normalizedEmail, password };
};

// 認証サービスのエラーのうち、監査ログに「ログインの失敗」として残すもの。
// 通信の失敗・認証サービス側の回数制限・想定外のエラーは、本人の認証の失敗ではないので監査ログには残さない
// （サーバのログに残す）。残さないものはロックにも数えない。
const toFailureReason = (error: { code?: string }): LoginFailureReason | null => {
  switch (error.code) {
    case 'invalid_credentials':
      return CREDENTIAL_FAILURE_REASON;
    case 'email_not_confirmed':
      return 'email_not_confirmed';
    case 'user_banned':
      return 'user_banned';
    default:
      return null;
  }
};

export const POST = async (request: NextRequest) => {
  if (!isSameOriginRequest(request)) {
    return failure(LOGIN_ERROR_MESSAGES.forbiddenOrigin, 403);
  }

  const credentials = await readCredentials(request);
  if (!credentials) {
    return failure(LOGIN_ERROR_MESSAGES.invalidRequest, 400);
  }
  const { email, password } = credentials;

  // 接続元ごとの上限（失敗だけを数える）
  const clientKey = auditContextFromHeaders(request.headers).ip ?? 'unknown';
  const throttledSeconds = loginFailureThrottle.retryAfterSeconds(clientKey);
  if (throttledSeconds !== null) {
    return failure(LOGIN_ERROR_MESSAGES.rateLimited, 429, { code: 'rate_limited' }, { 'Retry-After': String(throttledSeconds) });
  }

  // メールアドレスの形をしていないものは、どのアカウントのものでもない。認証サービスに問い合わせず、
  // 監査ログにも残さない（任意の文字列を監査ログに書かせない）。文言はパスワードの誤りと同じにする
  if (!isValidEmail(email)) {
    loginFailureThrottle.noteFailure(clientKey);
    return failure(LOGIN_ERROR_MESSAGES.invalidCredentials, 401, { code: 'invalid_credentials' });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    logger.error({ error }, 'ログインの処理を始められませんでした（SUPABASE_SERVICE_ROLE_KEY を確認してください）');
    return failure(LOGIN_ERROR_MESSAGES.unknown, 500);
  }

  const target = await resolveLoginTarget(admin, email);

  // 止めているあいだは、認証サービスに問い合わせない（失敗としても数えない）
  const before = await getLoginLockout(admin, target);
  if (before.locked && before.lockedUntil !== null) {
    await ensureLoginLockRecorded(admin, target, before);
    return lockedResponse(before.lockedUntil, Date.now());
  }

  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    const authError = error ?? { code: 'unexpected_failure' };
    const reason = toFailureReason(authError);
    if (!reason) {
      logger.warn(
        { code: authError.code, status: 'status' in authError ? authError.status : undefined },
        'ログインの問い合わせに失敗しました（認証情報の誤り以外）',
      );
      const status = authError.code === 'over_request_rate_limit' || ('status' in authError && authError.status === 429) ? 429 : 502;
      return failure(toLoginErrorMessage(authError), status);
    }

    loginFailureThrottle.noteFailure(clientKey);
    const after = await recordLoginFailure(admin, target, reason, before.failureCount);
    if (after.locked && after.lockedUntil !== null) {
      return lockedResponse(after.lockedUntil, Date.now());
    }
    // アカウントが無い場合とパスワードが違う場合は、認証サービスが同じエラー（invalid_credentials）を返すので、
    // 文言も同じになる。確認がまだ・利用停止は、認証サービスが返す区別をそのまま日本語にして伝える
    return failure(toLoginErrorMessage(authError), 401, { code: reason });
  }

  // 成功。ログインの記録は DB のトリガー（auth.sessions）が残す。
  // 二要素認証が要るかを伝える（案内のため。強制はサーバと DB が行う）
  let mfa: ReturnType<typeof decideMfaState> = 'ok';
  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('role, organizations(requireMfaForInternal)')
      .eq('id', data.user.id)
      .maybeSingle();
    const row = profile as {
      role: unknown;
      organizations: { requireMfaForInternal: boolean | null } | { requireMfaForInternal: boolean | null }[] | null;
    } | null;
    const organization = Array.isArray(row?.organizations) ? (row?.organizations[0] ?? null) : (row?.organizations ?? null);
    mfa = decideMfaState({
      verifiedFactorCount: verifiedFactors(data.user.factors).length,
      aal: 'aal1',
      role: row && isMemberRole(row.role) ? row.role : null,
      requireMfaForInternal: organization?.requireMfaForInternal === true,
    });
  } catch (profileError) {
    logger.error({ error: profileError }, 'ログイン後の二要素認証の状態を取得できませんでした');
  }

  return NextResponse.json({ ok: true, mfa }, { headers: noStore });
};
