import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// 監査ログへの書き込み（recordAuditEvent）と、失敗の行の読み出し（system_audit_logs）をモックし、
// 「どの行を数えるか」「いつ『止めた』を残すか」を確かめる。数え方そのものは loginLockout.test.ts。
const mocks = vi.hoisted(() => ({
  recordAuditEvent: vi.fn(async () => true),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/audit/events', () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('@/lib/logging/logger', () => ({ logger: { warn: mocks.warn, error: mocks.error } }));

import {
  ensureLoginLockRecorded,
  getLoginLockout,
  getMfaLockout,
  getReauthLockout,
  recordLoginFailure,
  recordMfaFailure,
  recordReauthFailure,
  resetUnknownAddressLog,
  resolveLoginTarget,
  UNKNOWN_ADDRESS_LOG_LIMIT,
  type LoginTarget,
} from '../attemptLog';

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * MIN).toISOString();

interface Row {
  action: string;
  createdAt: string;
  detail: string | null;
  outcome?: string;
}

interface Recorded {
  table: string;
  filters: [string, string, unknown][];
}

// 問い合わせの組み立てを記録し、最後に rows を返すだけのクライアント
const fakeAdmin = (options: {
  profile?: { id: string; organizationId: string } | null;
  organizations?: { id: string }[];
  rows?: Row[];
  rowsError?: unknown;
}) => {
  const recorded: Recorded[] = [];
  const client = {
    from: (table: string) => {
      const entry: Recorded = { table, filters: [] };
      recorded.push(entry);
      const result = () => {
        if (table === 'profiles') return { data: options.profile ?? null, error: null };
        if (table === 'organizations') return { data: options.organizations ?? [], error: null };
        return options.rowsError ? { data: null, error: options.rowsError } : { data: options.rows ?? [], error: null };
      };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'is', 'gte', 'order']) {
        builder[method] = (...args: unknown[]) => {
          entry.filters.push([method, String(args[0]), args[1]]);
          return builder;
        };
      }
      builder.limit = () => (table === 'profiles' ? builder : Promise.resolve(result()));
      builder.maybeSingle = () => Promise.resolve(result());
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, recorded };
};

const failed = (minutesAgo: number, reason = 'invalid_credentials'): Row => ({
  action: 'auth.login.failed',
  createdAt: iso(minutesAgo),
  detail: JSON.stringify({ reason }),
});

const KNOWN: LoginTarget = { email: 'member@example.com', userId: 'user-1', organizationId: 'org-1' };
const UNKNOWN: LoginTarget = { email: 'nobody@example.com', userId: null, organizationId: 'org-1' };
const NO_ORG: LoginTarget = { email: 'nobody@example.com', userId: null, organizationId: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetUnknownAddressLog();
});

describe('resolveLoginTarget', () => {
  it('アカウントのメールアドレスなら、その人と所属の組織', async () => {
    const { client, recorded } = fakeAdmin({ profile: { id: 'user-1', organizationId: 'org-1' } });
    await expect(resolveLoginTarget(client, 'member@example.com')).resolves.toEqual(KNOWN);
    expect(recorded.map((entry) => entry.table)).toEqual(['profiles']);
  });

  it('アカウントのものでなく、組織が 1 つだけなら、その組織に残す', async () => {
    const { client } = fakeAdmin({ profile: null, organizations: [{ id: 'org-1' }] });
    await expect(resolveLoginTarget(client, 'nobody@example.com')).resolves.toEqual(UNKNOWN);
  });

  it('組織が複数ある（または無い）ときは、記録先が決まらない', async () => {
    const many = fakeAdmin({ profile: null, organizations: [{ id: 'org-1' }, { id: 'org-2' }] });
    await expect(resolveLoginTarget(many.client, 'nobody@example.com')).resolves.toEqual(NO_ORG);
    const none = fakeAdmin({ profile: null, organizations: [] });
    await expect(resolveLoginTarget(none.client, 'nobody@example.com')).resolves.toEqual(NO_ORG);
  });
});

describe('getLoginLockout', () => {
  it('アカウントのメールアドレスは、本人の id で、決まりの 2 倍の時間まで遡って数える', async () => {
    const { client, recorded } = fakeAdmin({ rows: [failed(3), failed(2), failed(1)] });
    const status = await getLoginLockout(client, KNOWN, NOW);
    expect(status).toEqual({ locked: false, lockedUntil: null, failureCount: 3, lockRecorded: false });

    const [query] = recorded;
    expect(query.table).toBe('system_audit_logs');
    expect(query.filters).toContainEqual(['eq', 'organizationId', 'org-1']);
    // パスワードの再設定（それより前の失敗を数えなくする操作）の記録も一緒に読む
    expect(query.filters).toContainEqual(['in', 'action', ['auth.login.failed', 'auth.login.locked', 'auth.password.reset']]);
    expect(query.filters).toContainEqual(['eq', 'userId', 'user-1']);
    expect(query.filters).toContainEqual(['gte', 'createdAt', iso(30)]);
  });

  it('アカウントのものでないメールアドレスは、操作した人が空の行を、試したメールアドレスで数える', async () => {
    const { client, recorded } = fakeAdmin({ rows: [] });
    await getLoginLockout(client, UNKNOWN, NOW);
    expect(recorded[0].filters).toContainEqual(['is', 'userId', null]);
    expect(recorded[0].filters).toContainEqual(['eq', 'actorEmail', 'nobody@example.com']);
    // アカウントが無いので、パスワードの再設定の記録は見ない
    expect(recorded[0].filters).toContainEqual(['in', 'action', ['auth.login.failed', 'auth.login.locked']]);
  });

  it('パスワードの再設定に成功したら、それより前の失敗は数えない（本人が、止められたログインを自分で戻せる）', async () => {
    const reset = (minutesAgo: number, outcome = 'success'): Row => ({ action: 'auth.password.reset', createdAt: iso(minutesAgo), detail: '{}', outcome });
    // 5 回失敗して止まったあと、3 分前に再設定した
    const cleared = await getLoginLockout(
      fakeAdmin({ rows: [failed(9), failed(8), failed(7), failed(6), failed(5), reset(3)] }).client,
      KNOWN,
      NOW,
    );
    expect(cleared).toMatchObject({ locked: false, failureCount: 0 });

    // 再設定のあとの失敗は、また 1 から数える
    const again = await getLoginLockout(
      fakeAdmin({ rows: [failed(9), failed(8), failed(7), failed(6), failed(5), reset(3), failed(2), failed(1)] }).client,
      KNOWN,
      NOW,
    );
    expect(again).toMatchObject({ locked: false, failureCount: 2 });
  });

  it('拒否された再設定（メールのリンクを踏んでいないセッションからの試み）では、失敗の数は消えない', async () => {
    const denied: Row = { action: 'auth.password.reset', createdAt: iso(3), detail: '{"reason":"not_recovery_session"}', outcome: 'denied' };
    const status = await getLoginLockout(
      fakeAdmin({ rows: [failed(9), failed(8), failed(7), failed(6), failed(5), denied] }).client,
      KNOWN,
      NOW,
    );
    expect(status.locked).toBe(true);
  });

  it('5 回の失敗で止める。「止めた」記録があるかも返す', async () => {
    const rows = [failed(5), failed(4), failed(3), failed(2), failed(1)];
    const withoutRecord = await getLoginLockout(fakeAdmin({ rows }).client, KNOWN, NOW);
    expect(withoutRecord).toEqual({ locked: true, lockedUntil: NOW + 14 * MIN, failureCount: 5, lockRecorded: false });

    const withRecord = await getLoginLockout(
      fakeAdmin({ rows: [...rows, { action: 'auth.login.locked', createdAt: iso(1), detail: '{}' }] }).client,
      KNOWN,
      NOW,
    );
    expect(withRecord.lockRecorded).toBe(true);
  });

  it('前のロックの「止めた」記録は、いまのロックの記録とはみなさない', async () => {
    const rows = [
      failed(29), failed(28), failed(27), failed(26), failed(25),
      { action: 'auth.login.locked', createdAt: iso(25), detail: '{}' },
      failed(5), failed(4), failed(3), failed(2), failed(1),
    ];
    const status = await getLoginLockout(fakeAdmin({ rows }).client, KNOWN, NOW);
    expect(status.locked).toBe(true);
    expect(status.lockRecorded).toBe(false);
  });

  it('パスワードの誤り以外の失敗（確認がまだ・利用停止）は数えない', async () => {
    const rows = [failed(5, 'email_not_confirmed'), failed(4, 'user_banned'), failed(3), failed(2), failed(1), { ...failed(0.5), detail: 'not json' }];
    const status = await getLoginLockout(fakeAdmin({ rows }).client, KNOWN, NOW);
    expect(status).toMatchObject({ locked: false, failureCount: 3 });
  });

  it('記録先の組織が決まらなければ、止めない（数える先が無い）', async () => {
    const { client, recorded } = fakeAdmin({ rows: [failed(1)] });
    await expect(getLoginLockout(client, NO_ORG, NOW)).resolves.toMatchObject({ locked: false, failureCount: 0 });
    expect(recorded).toEqual([]);
  });

  it('監査ログを読めなかったときは止めずに続け、サーバのログに残す', async () => {
    const { client } = fakeAdmin({ rowsError: { message: 'boom' } });
    await expect(getLoginLockout(client, KNOWN, NOW)).resolves.toMatchObject({ locked: false, failureCount: 0 });
    expect(mocks.error).toHaveBeenCalled();
  });
});

describe('recordLoginFailure', () => {
  const { client } = fakeAdmin({});

  it('失敗を残す（理由だけ。パスワードは渡さない）。4 回目までは止めない', async () => {
    const status = await recordLoginFailure(client, KNOWN, 'invalid_credentials', 3, NOW);
    expect(status).toEqual({ locked: false, lockedUntil: null, failureCount: 4, lockRecorded: false });
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: 'user-1', email: 'member@example.com' },
      { action: 'auth.login.failed', entityName: 'auth.users', entityId: 'user-1', detail: { reason: 'invalid_credentials' }, outcome: 'failure' },
      client,
    );
  });

  it('アカウントのものでないメールアドレスは、操作した人を空にして、試したメールアドレスを残す', async () => {
    await recordLoginFailure(client, UNKNOWN, 'invalid_credentials', 0, NOW);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: null, email: 'nobody@example.com' },
      expect.objectContaining({ action: 'auth.login.failed', entityId: null, outcome: 'failure' }),
      client,
    );
  });

  it('5 回目の失敗で、「止めた」ことを 1 回残す', async () => {
    const status = await recordLoginFailure(client, KNOWN, 'invalid_credentials', 4, NOW);
    expect(status).toEqual({ locked: true, lockedUntil: NOW + 15 * MIN, failureCount: 5, lockRecorded: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(2);
    expect(mocks.recordAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      {
        action: 'auth.login.locked',
        entityName: 'auth.users',
        entityId: 'user-1',
        detail: { failures: 5, windowMinutes: 15, lockedUntil: new Date(NOW + 15 * MIN).toISOString() },
        outcome: 'denied',
      },
      client,
    );
  });

  it('パスワードの誤り以外の理由は、残すが回数に数えない', async () => {
    const status = await recordLoginFailure(client, KNOWN, 'user_banned', 4, NOW);
    expect(status).toMatchObject({ locked: false, failureCount: 4 });
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('記録先の組織が決まらなければ、監査ログには残さず、サーバのログにだけ残す', async () => {
    const status = await recordLoginFailure(client, NO_ORG, 'invalid_credentials', 0, NOW);
    expect(status.locked).toBe(false);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith({ email: 'nobody@example.com', reason: 'invalid_credentials' }, expect.any(String));
  });
});

describe('ensureLoginLockRecorded', () => {
  const { client } = fakeAdmin({});
  const locked = { locked: true, lockedUntil: NOW + 10 * MIN, failureCount: 5 };

  it('止めているのに記録が無ければ、1 回残す', async () => {
    await ensureLoginLockRecorded(client, KNOWN, { ...locked, lockRecorded: false });
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'auth.login.locked', outcome: 'denied' }),
      client,
    );
  });

  it('記録がもうあれば、止めているあいだの試行では何も残さない', async () => {
    await ensureLoginLockRecorded(client, KNOWN, { ...locked, lockRecorded: true });
    await ensureLoginLockRecorded(client, KNOWN, { locked: false, lockedUntil: null, failureCount: 2, lockRecorded: false });
    await ensureLoginLockRecorded(client, NO_ORG, { ...locked, lockRecorded: false });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe('二要素認証のコードの確認', () => {
  const subject = { organizationId: 'org-1', userId: 'user-1' };

  it('本人の auth.mfa.verify.failed を数える', async () => {
    const rows: Row[] = [1, 2, 3, 4, 5].map((minute) => ({
      action: 'auth.mfa.verify.failed',
      createdAt: iso(minute),
      detail: JSON.stringify({ reason: 'invalid_credentials', phase: 'login' }),
    }));
    const { client, recorded } = fakeAdmin({ rows });
    await expect(getMfaLockout(client, subject, NOW)).resolves.toMatchObject({ locked: true, lockRecorded: false });
    expect(recorded[0].filters).toContainEqual(['in', 'action', ['auth.mfa.verify.failed', 'auth.mfa.locked']]);
    expect(recorded[0].filters).toContainEqual(['eq', 'userId', 'user-1']);
  });

  it('失敗を残す（コードは残さない）。5 回目で auth.mfa.locked を残す', async () => {
    const { client } = fakeAdmin({});
    await recordMfaFailure(client, subject, 'login', 0, NOW);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      subject,
      { action: 'auth.mfa.verify.failed', entityName: 'auth.users', entityId: 'user-1', detail: { reason: 'invalid_credentials', phase: 'login' }, outcome: 'failure' },
      client,
    );

    mocks.recordAuditEvent.mockClear();
    const status = await recordMfaFailure(client, subject, 'enroll', 4, NOW);
    expect(status.locked).toBe(true);
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(2);
    expect(mocks.recordAuditEvent).toHaveBeenLastCalledWith(subject, expect.objectContaining({ action: 'auth.mfa.locked', outcome: 'denied' }), client);
  });
});

describe('アカウントの無いメールアドレスでの失敗の件数の上限', () => {
  it('決まった件数までは監査ログに残し、超えた分はサーバのログにだけ残す（追記専用のログを際限なく増やさせない）', async () => {
    const { client } = fakeAdmin({});
    for (let index = 0; index < UNKNOWN_ADDRESS_LOG_LIMIT; index += 1) {
      await recordLoginFailure(client, { ...UNKNOWN, email: `nobody-${index}@example.com` }, 'invalid_credentials', 0, NOW);
    }
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(UNKNOWN_ADDRESS_LOG_LIMIT);

    const over = await recordLoginFailure(client, { ...UNKNOWN, email: 'one-more@example.com' }, 'invalid_credentials', 0, NOW);
    expect(over.locked).toBe(false);
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(UNKNOWN_ADDRESS_LOG_LIMIT);
    expect(mocks.warn).toHaveBeenCalled();
  });

  it('上限を超えたあとも、アカウントの無いメールアドレスは同じ回数で止まる（止まり方で、アカウントの有無を見分けさせない）', async () => {
    const { client } = fakeAdmin({ rows: [] });
    // 上限を使い切る
    for (let index = 0; index < UNKNOWN_ADDRESS_LOG_LIMIT; index += 1) {
      await recordLoginFailure(client, { ...UNKNOWN, email: `filler-${index}@example.com` }, 'invalid_credentials', 0, NOW);
    }
    vi.clearAllMocks();

    // ここから先は監査ログに残らないが、5 回目で止まる
    const probe = { ...UNKNOWN, email: 'probe@example.com' };
    let status = await getLoginLockout(client, probe, NOW);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(status.locked, `${attempt} 回目の前`).toBe(false);
      status = await recordLoginFailure(client, probe, 'invalid_credentials', status.failureCount, NOW + attempt);
    }
    expect(status.locked).toBe(true);
    // 次の試行の前の確認でも、止まっている（「止めた」記録は足さない）
    const next = await getLoginLockout(client, probe, NOW + 10);
    expect(next).toMatchObject({ locked: true, lockRecorded: true });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();

    // 別のメールアドレスは、まだ止まっていない
    const other = await getLoginLockout(client, { ...UNKNOWN, email: 'other@example.com' }, NOW + 10);
    expect(other.locked).toBe(false);
  });

  it('アカウントのメールアドレスでの失敗は、上限にかかわらず残す', async () => {
    const { client } = fakeAdmin({});
    for (let index = 0; index < UNKNOWN_ADDRESS_LOG_LIMIT + 1; index += 1) {
      await recordLoginFailure(client, UNKNOWN, 'invalid_credentials', 0, NOW);
    }
    vi.clearAllMocks();
    await recordLoginFailure(client, KNOWN, 'invalid_credentials', 0, NOW);
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
  });
});

describe('本人確認（パスワードの再入力）', () => {
  const subject = { organizationId: 'org-1', userId: 'user-1' };

  it('本人の auth.reauth.failed を、ログインとは別に数える', async () => {
    const reauthFailed = (minutesAgo: number): Row => ({ action: 'auth.reauth.failed', createdAt: iso(minutesAgo), detail: JSON.stringify({ reason: 'invalid_credentials' }) });
    const { client, recorded } = fakeAdmin({ rows: [reauthFailed(4), reauthFailed(3), reauthFailed(2), reauthFailed(1), failed(1)] });
    const status = await getReauthLockout(client, subject, NOW);
    expect(status).toMatchObject({ locked: false, failureCount: 4 });
    expect(recorded[0].filters).toContainEqual(['in', 'action', ['auth.reauth.failed', 'auth.reauth.locked', 'auth.password.reset']]);
    expect(recorded[0].filters).toContainEqual(['eq', 'userId', 'user-1']);
  });

  it('失敗を残す（パスワードは残さない）。5 回目で auth.reauth.locked を残す', async () => {
    const { client } = fakeAdmin({});
    const fourth = await recordReauthFailure(client, subject, 3, NOW);
    expect(fourth.locked).toBe(false);
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenLastCalledWith(
      subject,
      { action: 'auth.reauth.failed', entityName: 'auth.users', entityId: 'user-1', detail: { reason: 'invalid_credentials' }, outcome: 'failure' },
      client,
    );

    const fifth = await recordReauthFailure(client, subject, 4, NOW);
    expect(fifth.locked).toBe(true);
    expect(mocks.recordAuditEvent).toHaveBeenLastCalledWith(
      subject,
      expect.objectContaining({ action: 'auth.reauth.locked', outcome: 'denied' }),
      client,
    );
  });
});

