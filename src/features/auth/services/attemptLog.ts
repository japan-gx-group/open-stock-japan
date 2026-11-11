// ログインと二要素認証の「失敗」を監査ログ（system_audit_logs）に残し、そこから失敗の回数を数える（サーバ専用）。
// 止めるかどうかの決まりは src/features/auth/utils/loginLockout.ts（純粋な関数）。ここは読み書きだけ。
//
// 残す操作の名前:
//   auth.login.failed        ログインの失敗（outcome = failure）。detail.reason に大まかな理由
//   auth.login.locked        失敗が続いたので、そのメールアドレスでのログインを一時的に止めた（outcome = denied）。止めるたびに 1 回
//   auth.mfa.verify.failed   二要素認証のコードの確認の失敗（outcome = failure）。detail.phase = login（ログイン時）/ enroll（登録時）
//   auth.mfa.locked          コードの失敗が続いたので、確認を一時的に止めた（outcome = denied）。止めるたびに 1 回
// ログインの成功は、DB のトリガーが auth.login として残す（ここでは残さない。二重になる）。
//
// 監査ログは追記専用で、あとから直せない。パスワード・コード・TOTP の秘密の値は detail に入れないこと。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditEvent, type AuditActor } from '@/lib/audit/events';
import { logger } from '@/lib/logging/logger';
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';
import {
  LOGIN_LOCKOUT_RULE,
  MFA_LOCKOUT_RULE,
  evaluateLockout,
  lockoutWindowMinutes,
  type LockoutRule,
  type LockoutStatus,
} from '@/features/auth/utils/loginLockout';

/** ロックに数える失敗の理由（パスワード・コードの誤り）。それ以外の理由の失敗は、残すが数えない */
export const CREDENTIAL_FAILURE_REASON = 'invalid_credentials';

export type LoginFailureReason = typeof CREDENTIAL_FAILURE_REASON | 'email_not_confirmed' | 'user_banned';

/** いま止めているかと、その「止めた」記録がもう残っているか */
export interface AttemptStatus extends LockoutStatus {
  /** いまのロックについて、「止めた」記録（…locked）が監査ログにあるか。止めていなければ false */
  lockRecorded: boolean;
}

const NOT_LOCKED: AttemptStatus = { locked: false, lockedUntil: null, failureCount: 0, lockRecorded: false };

interface AttemptKind {
  failedAction: string;
  lockedAction: string;
  rule: LockoutRule;
  /**
   * この操作が成功したら、それより前の失敗を数えない（止めている状態も解ける）。
   * パスワードを再設定できたのは、メールを受け取れる本人だけ。本人が、他人のいやがらせで止められたログインを
   * 自分で戻せるようにする。
   */
  clearedBy?: string;
}

// パスワードの再設定（メールのリンク経由）に成功したときの記録（src/features/auth/services/passwordRecovery.ts）
const PASSWORD_RESET_ACTION = 'auth.password.reset';

const LOGIN_ATTEMPT: AttemptKind = {
  failedAction: 'auth.login.failed',
  lockedAction: 'auth.login.locked',
  rule: LOGIN_LOCKOUT_RULE,
  clearedBy: PASSWORD_RESET_ACTION,
};
const MFA_ATTEMPT: AttemptKind = { failedAction: 'auth.mfa.verify.failed', lockedAction: 'auth.mfa.locked', rule: MFA_LOCKOUT_RULE };
// 本人確認（ログイン中に、被害の大きい操作の前にパスワードをもう一度確かめる）。ログインとは別に数える
const REAUTH_ATTEMPT: AttemptKind = {
  failedAction: 'auth.reauth.failed',
  lockedAction: 'auth.reauth.locked',
  rule: LOGIN_LOCKOUT_RULE,
  clearedBy: PASSWORD_RESET_ACTION,
};

/** 数える単位。アカウント（userId）か、どのアカウントのものでもないメールアドレス（actorEmail） */
type AttemptKey = { organizationId: string; userId: string } | { organizationId: string; anonymousEmail: string };

interface AttemptRow {
  action: string;
  createdAt: string;
  detail: string | null;
  outcome?: string | null;
}

const reasonOf = (detail: string | null): string | null => {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as { reason?: unknown };
    return typeof parsed.reason === 'string' ? parsed.reason : null;
  } catch {
    return null;
  }
};

// 失敗と「止めた」記録を読んで、いまの状態を決める。
// いま効いているロックを決めるには、決まりの時間の 2 倍前までの失敗が要る（loginLockout.ts）。
// 読めなかったときは「止めていない」として続ける。監査ログが読めないときにだれもログインできなくなるのを避け、
// 異常はサーバのログに残す（認証サービス側の回数制限は、この場合も効く）。
const loadAttemptStatus = async (
  admin: SupabaseClient,
  kind: AttemptKind,
  key: AttemptKey,
  now: number,
  /** 監査ログに残さなかった失敗の時刻（件数の上限を超えた分）。監査ログの失敗と合わせて数える */
  unrecordedFailureTimes: number[] = [],
): Promise<AttemptStatus> => {
  // 「それより前の失敗を数えない」操作（パスワードの再設定）は、アカウントについて数えるときだけ見る
  const clearedBy = 'userId' in key ? kind.clearedBy : undefined;
  let query = admin
    .from('system_audit_logs')
    .select('action, createdAt, detail, outcome')
    .eq('organizationId', key.organizationId)
    .in('action', clearedBy ? [kind.failedAction, kind.lockedAction, clearedBy] : [kind.failedAction, kind.lockedAction])
    .gte('createdAt', new Date(now - kind.rule.windowMs * 2).toISOString());
  query = 'userId' in key ? query.eq('userId', key.userId) : query.is('userId', null).eq('actorEmail', key.anonymousEmail);

  const { data, error } = await query.order('createdAt', { ascending: true }).limit(500);
  if (error) {
    logger.error({ error, action: kind.failedAction }, '失敗の回数の取得に失敗しました（一時停止の判定をせずに続けます）');
    return NOT_LOCKED;
  }

  const rows = (data as AttemptRow[] | null) ?? [];
  const timeOf = (row: AttemptRow): number => new Date(row.createdAt).getTime();
  // パスワードの再設定に成功した時刻（あれば、いちばん新しいもの）。それより前の失敗は数えない
  const clearedAt = clearedBy
    ? rows
        .filter((row) => row.action === clearedBy && (row.outcome ?? 'success') === 'success')
        .map(timeOf)
        .filter((time) => Number.isFinite(time))
        .reduce((latest, time) => Math.max(latest, time), 0)
    : 0;
  const failureTimes = rows
    .filter((row) => row.action === kind.failedAction && reasonOf(row.detail) === CREDENTIAL_FAILURE_REASON)
    .map(timeOf)
    .concat(unrecordedFailureTimes)
    .filter((time) => Number.isFinite(time) && time > clearedAt)
    .sort((a, b) => a - b);
  const status = evaluateLockout(failureTimes, now, kind.rule);
  if (!status.locked || status.lockedUntil === null) {
    return { ...status, lockRecorded: false };
  }

  // このロックが始まった時刻（= 引き金になった失敗の時刻）よりあとに、「止めた」記録があるか。
  // 記録は失敗の直後に書くので、時計のずれを見込んで 1 秒だけ手前から探す
  const lockStartedAt = status.lockedUntil - kind.rule.windowMs;
  const lockRecorded = rows.some((row) => row.action === kind.lockedAction && timeOf(row) >= lockStartedAt - 1000);
  return { ...status, lockRecorded };
};

const recordLock = async (admin: SupabaseClient, kind: AttemptKind, actor: AuditActor, lockedUntil: number): Promise<void> => {
  await recordAuditEvent(
    actor,
    {
      action: kind.lockedAction,
      entityName: 'auth.users',
      entityId: actor.userId,
      detail: {
        failures: kind.rule.maxFailures,
        windowMinutes: lockoutWindowMinutes(kind.rule),
        lockedUntil: new Date(lockedUntil).toISOString(),
      },
      outcome: 'denied',
    },
    admin,
  );
};

// 失敗を残したあとの状態。これで決まりの回数に達したら「止めた」ことも残す
const afterFailure = async (
  admin: SupabaseClient,
  kind: AttemptKind,
  actor: AuditActor,
  failuresBefore: number,
  now: number,
): Promise<AttemptStatus> => {
  const failureCount = failuresBefore + 1;
  if (failureCount < kind.rule.maxFailures) {
    return { locked: false, lockedUntil: null, failureCount, lockRecorded: false };
  }
  const lockedUntil = now + kind.rule.windowMs;
  await recordLock(admin, kind, actor, lockedUntil);
  return { locked: true, lockedUntil, failureCount: kind.rule.maxFailures, lockRecorded: true };
};

// ---------------------------------------------------------------------------
// ログイン
// ---------------------------------------------------------------------------

/** ログインを試したメールアドレスが、どのアカウント・組織のものか */
export interface LoginTarget {
  /** 試したメールアドレス（前後の空白を除き、小文字にしたもの） */
  email: string;
  /** メールアドレスがアカウントのものなら、その人の id。違えば null */
  userId: string | null;
  /** 記録先の組織。アカウントの所属、またはこの環境に組織が 1 つだけならその組織。決まらなければ null */
  organizationId: string | null;
}

/**
 * メールアドレスから、記録先（アカウントと組織）を決める。
 *   - アカウントのメールアドレスなら、その人の組織
 *   - そうでなく、この環境の組織が 1 つだけなら、その組織（自社ホスト・1 社の構成）
 *   - どちらでもなければ決まらない（監査ログには残せないので、サーバのログにだけ残す）
 */
export const resolveLoginTarget = async (admin: SupabaseClient, email: string): Promise<LoginTarget> => {
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, organizationId')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if (profileError) {
    logger.error({ error: profileError }, 'ログインの記録先（プロフィール）の取得に失敗しました');
  }
  const known = profile as { id: string; organizationId: string } | null;
  if (known) {
    return { email, userId: known.id, organizationId: known.organizationId };
  }

  const { data: organizations, error: organizationError } = await admin.from('organizations').select('id').limit(2);
  if (organizationError) {
    logger.error({ error: organizationError }, 'ログインの記録先（組織）の取得に失敗しました');
  }
  const rows = (organizations as { id: string }[] | null) ?? [];
  return { email, userId: null, organizationId: rows.length === 1 ? rows[0].id : null };
};

const loginActor = (target: LoginTarget & { organizationId: string }): AuditActor => ({
  organizationId: target.organizationId,
  userId: target.userId,
  // アカウントのものでないメールアドレスは、ここで渡した値が「操作した人」の欄に残る
  // （アカウントのものなら、DB がプロフィールのメールアドレスとロールで上書きする）
  email: target.email,
});

// アカウントのメールアドレスなら本人の id で、そうでなければ試したメールアドレスで数える
const loginKey = (target: LoginTarget & { organizationId: string }): AttemptKey =>
  target.userId
    ? { organizationId: target.organizationId, userId: target.userId }
    : { organizationId: target.organizationId, anonymousEmail: target.email };

const hasOrganization = (target: LoginTarget): target is LoginTarget & { organizationId: string } =>
  target.organizationId !== null;

/** アカウントの無いメールアドレスでの失敗を、監査ログに残す件数の上限（組織ごと・1 時間あたり） */
export const UNKNOWN_ADDRESS_LOG_LIMIT = 60;
export const UNKNOWN_ADDRESS_LOG_WINDOW_MS = 60 * 60 * 1000;

// プロセス内のカウンタ。複数台で動かすと、台数ぶんまで残り得る
const unknownAddressLog = createFixedWindowRateLimiter({ limit: UNKNOWN_ADDRESS_LOG_LIMIT, windowMs: UNKNOWN_ADDRESS_LOG_WINDOW_MS });

// 監査ログに残さなかった失敗の時刻（メールアドレスごと。プロセス内）。ロックの判定にだけ使う。
// 覚えておく件数に上限を置き、古いものから捨てる（でたらめなメールアドレスを大量に試されても、メモリを使い切らない）。
const MAX_UNRECORDED_ADDRESSES = 5000;
const unrecordedFailures = new Map<string, number[]>();

const unrecordedKey = (target: LoginTarget & { organizationId: string }): string => `${target.organizationId}:${target.email}`;

const unrecordedFailureTimesOf = (target: LoginTarget & { organizationId: string }, now: number): number[] => {
  const since = now - LOGIN_LOCKOUT_RULE.windowMs * 2;
  return (unrecordedFailures.get(unrecordedKey(target)) ?? []).filter((time) => time >= since);
};

const rememberUnrecordedFailure = (target: LoginTarget & { organizationId: string }, now: number): void => {
  const key = unrecordedKey(target);
  const times = unrecordedFailureTimesOf(target, now);
  times.push(now);
  // 入れ直して、いちばん新しい位置へ（Map は入れた順に並ぶ）
  unrecordedFailures.delete(key);
  unrecordedFailures.set(key, times);
  while (unrecordedFailures.size > MAX_UNRECORDED_ADDRESSES) {
    const oldest = unrecordedFailures.keys().next().value;
    if (oldest === undefined) break;
    unrecordedFailures.delete(oldest);
  }
};

/** テスト用 */
export const resetUnknownAddressLog = (): void => {
  unknownAddressLog.reset();
  unrecordedFailures.clear();
};

/** そのメールアドレスでのログインを、いま止めているか */
export const getLoginLockout = async (
  admin: SupabaseClient,
  target: LoginTarget,
  now: number = Date.now(),
): Promise<AttemptStatus> => {
  if (!hasOrganization(target)) return NOT_LOCKED;
  if (target.userId) return loadAttemptStatus(admin, LOGIN_ATTEMPT, loginKey(target), now);

  // アカウントの無いメールアドレス。監査ログに残さなかった失敗（件数の上限を超えた分）も合わせて数える。
  // 合わせないと、上限を超えたあとは「アカウントの無いメールアドレスは止まらず、あるメールアドレスだけ止まる」ことになり、
  // 止まるかどうかで、アカウントがあるかを外から見分けられてしまう。
  const unrecorded = unrecordedFailureTimesOf(target, now);
  const status = await loadAttemptStatus(admin, LOGIN_ATTEMPT, loginKey(target), now, unrecorded);
  // 残さなかった失敗が効いているロックでは、「止めた」記録も足さない（上限を超えて監査ログを増やさない）
  return unrecorded.length > 0 && status.locked ? { ...status, lockRecorded: true } : status;
};

/**
 * 止めているあいだの試行のときに呼ぶ。「止めた」記録がまだ無ければ（同時の失敗で書きそびれた場合）ここで 1 回だけ残す。
 * 止めているあいだの試行そのものは、1 件ずつは残さない。
 */
export const ensureLoginLockRecorded = async (
  admin: SupabaseClient,
  target: LoginTarget,
  status: AttemptStatus,
): Promise<void> => {
  if (!hasOrganization(target) || !status.locked || status.lockRecorded || status.lockedUntil === null) return;
  await recordLock(admin, LOGIN_ATTEMPT, loginActor(target), status.lockedUntil);
};

/**
 * ログインの失敗を残す。パスワードの誤りで、これで決まりの回数に達したら「止めた」ことも 1 回残し、
 * 止めた状態を返す（達していなければ locked = false）。
 */
export const recordLoginFailure = async (
  admin: SupabaseClient,
  target: LoginTarget,
  reason: LoginFailureReason,
  failuresBefore: number,
  now: number = Date.now(),
): Promise<AttemptStatus> => {
  if (!hasOrganization(target)) {
    // 組織が決まらない（複数の組織がある環境で、どのアカウントのものでもないメールアドレス）。
    // 監査ログは組織ごとの連番なので残せない。サーバのログにだけ残す
    logger.warn({ email: target.email, reason }, 'ログインに失敗しました（記録先の組織が決まらないため、監査ログには残していません）');
    return NOT_LOCKED;
  }

  // どのアカウントのものでもないメールアドレスでの失敗は、決まった件数までしか監査ログに残さない。
  // 監査ログは追記専用で消せないので、でたらめなメールアドレスを次々に試すだけで、際限なく増やせてしまう。
  // 超えた分はサーバのログにだけ残す（アカウントのメールアドレスでの失敗は、すべて残す）。
  if (!target.userId && !unknownAddressLog.consume(target.organizationId, now)) {
    logger.warn({ reason }, 'ログインに失敗しました（アカウントの無いメールアドレス。件数の上限を超えたため、監査ログには残していません）');
    if (reason !== CREDENTIAL_FAILURE_REASON) {
      return { locked: false, lockedUntil: null, failureCount: failuresBefore, lockRecorded: false };
    }
    // 監査ログには残さないが、回数は数える。アカウントのあるメールアドレスと同じ回数で、同じように止める
    // （止まり方の違いで、アカウントがあるかどうかを見分けさせない）。
    rememberUnrecordedFailure(target, now);
    const failureCount = failuresBefore + 1;
    return failureCount >= LOGIN_ATTEMPT.rule.maxFailures
      ? { locked: true, lockedUntil: now + LOGIN_ATTEMPT.rule.windowMs, failureCount: LOGIN_ATTEMPT.rule.maxFailures, lockRecorded: true }
      : { locked: false, lockedUntil: null, failureCount, lockRecorded: false };
  }

  const actor = loginActor(target);
  await recordAuditEvent(
    actor,
    { action: LOGIN_ATTEMPT.failedAction, entityName: 'auth.users', entityId: target.userId, detail: { reason }, outcome: 'failure' },
    admin,
  );
  if (reason !== CREDENTIAL_FAILURE_REASON) {
    return { locked: false, lockedUntil: null, failureCount: failuresBefore, lockRecorded: false };
  }
  return afterFailure(admin, LOGIN_ATTEMPT, actor, failuresBefore, now);
};

// ---------------------------------------------------------------------------
// 二要素認証のコードの確認
// ---------------------------------------------------------------------------

export interface MfaSubject {
  organizationId: string;
  userId: string;
}

/** 二要素認証のコードの確認を、その人についていま止めているか */
export const getMfaLockout = async (
  admin: SupabaseClient,
  subject: MfaSubject,
  now: number = Date.now(),
): Promise<AttemptStatus> => loadAttemptStatus(admin, MFA_ATTEMPT, subject, now);

export const ensureMfaLockRecorded = async (
  admin: SupabaseClient,
  subject: MfaSubject,
  status: AttemptStatus,
): Promise<void> => {
  if (!status.locked || status.lockRecorded || status.lockedUntil === null) return;
  await recordLock(admin, MFA_ATTEMPT, subject, status.lockedUntil);
};

/** コードの確認の失敗を残す。決まりの回数に達したら「止めた」ことも 1 回残す。コードそのものは残さない */
export const recordMfaFailure = async (
  admin: SupabaseClient,
  subject: MfaSubject,
  phase: 'login' | 'enroll',
  failuresBefore: number,
  now: number = Date.now(),
): Promise<AttemptStatus> => {
  await recordAuditEvent(
    subject,
    {
      action: MFA_ATTEMPT.failedAction,
      entityName: 'auth.users',
      entityId: subject.userId,
      detail: { reason: CREDENTIAL_FAILURE_REASON, phase },
      outcome: 'failure',
    },
    admin,
  );
  return afterFailure(admin, MFA_ATTEMPT, subject, failuresBefore, now);
};

// ---------------------------------------------------------------------------
// 本人確認（ログイン中の、パスワードの再入力）
// ---------------------------------------------------------------------------

/**
 * 本人確認を、その人についていま止めているか。
 * ログイン中のセッションを手に入れただけの人が、パスワードの変更・二要素認証の解除・API キーの差し替えの
 * 画面から、パスワードを何度でも試せないようにする（src/lib/reauth.ts）。
 */
export const getReauthLockout = async (
  admin: SupabaseClient,
  subject: MfaSubject,
  now: number = Date.now(),
): Promise<AttemptStatus> => loadAttemptStatus(admin, REAUTH_ATTEMPT, subject, now);

/** 本人確認の失敗を残す。決まりの回数に達したら「止めた」ことも 1 回残す。入力されたパスワードは残さない */
export const recordReauthFailure = async (
  admin: SupabaseClient,
  subject: MfaSubject,
  failuresBefore: number,
  now: number = Date.now(),
): Promise<AttemptStatus> => {
  await recordAuditEvent(
    subject,
    {
      action: REAUTH_ATTEMPT.failedAction,
      entityName: 'auth.users',
      entityId: subject.userId,
      detail: { reason: CREDENTIAL_FAILURE_REASON },
      outcome: 'failure',
    },
    admin,
  );
  return afterFailure(admin, REAUTH_ATTEMPT, subject, failuresBefore, now);
};

