import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ログインの API。認証サービス（signInWithPassword）・失敗の記録（attemptLog）・DB をモックし、
//   - 送り元の確認、入力の検証
//   - 失敗の記録と一時停止（止めているあいだは認証サービスに問い合わせない）
//   - メールアドレスの有無を教えない（同じ文言）
//   - 成功時に、二要素認証の状態を返す
// を確かめる。
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  resolveLoginTarget: vi.fn(),
  getLoginLockout: vi.fn(),
  ensureLoginLockRecorded: vi.fn(async () => undefined),
  recordLoginFailure: vi.fn(),
  profile: null as null | { role: string; organizations: { requireMfaForInternal: boolean } | null },
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/features/auth/services/authServerClient', () => ({
  createAuthServerClient: async () => ({ auth: { signInWithPassword: mocks.signIn } }),
}));

vi.mock('@/features/auth/services/attemptLog', () => ({
  CREDENTIAL_FAILURE_REASON: 'invalid_credentials',
  resolveLoginTarget: mocks.resolveLoginTarget,
  getLoginLockout: mocks.getLoginLockout,
  ensureLoginLockRecorded: mocks.ensureLoginLockRecorded,
  recordLoginFailure: mocks.recordLoginFailure,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profile, error: null }) }) }) }),
  }),
}));

vi.mock('@/lib/logging/logger', () => ({ logger: { warn: mocks.warn, error: mocks.error } }));

import { loginFailureThrottle, IP_FAILURE_LIMIT } from '@/features/auth/services/loginThrottle';
import { POST } from '../route';

const INVALID = 'メールアドレスまたはパスワードが正しくありません。';
const NOT_LOCKED = { locked: false, lockedUntil: null, failureCount: 0, lockRecorded: false };

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://stock.example.com/api/auth/login', {
    method: 'POST',
    headers: { origin: 'http://stock.example.com', host: 'stock.example.com', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.5', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const credentials = { email: 'member@example.com', password: 'correct horse' };

beforeEach(() => {
  vi.clearAllMocks();
  loginFailureThrottle.reset();
  mocks.profile = { role: 'logger', organizations: { requireMfaForInternal: false } };
  mocks.resolveLoginTarget.mockImplementation(async (_admin: unknown, email: string) => ({ email, userId: 'user-1', organizationId: 'org-1' }));
  mocks.getLoginLockout.mockResolvedValue(NOT_LOCKED);
  mocks.recordLoginFailure.mockResolvedValue({ ...NOT_LOCKED, failureCount: 1 });
  mocks.signIn.mockResolvedValue({ data: { user: { id: 'user-1', factors: [] }, session: {} }, error: null });
});

describe('POST /api/auth/login: 入口の確認', () => {
  it('送り元（Origin）がこのサイトでなければ 403。何も問い合わせない', async () => {
    for (const headers of [{ origin: 'https://evil.example.com' }, { origin: '' }]) {
      const response = await POST(request(credentials, headers));
      expect(response.status).toBe(403);
    }
    expect(mocks.resolveLoginTarget).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('本文が JSON でない・項目が足りない・長すぎるときは 400', async () => {
    const bodies = [
      'not json',
      {},
      { email: 'member@example.com' },
      { email: 'member@example.com', password: '' },
      { email: 123, password: 'x' },
      { email: `${'a'.repeat(250)}@example.com`, password: 'x' },
      { email: 'member@example.com', password: 'x'.repeat(1025) },
      { email: 'member@example.com', password: 'x', padding: 'y'.repeat(5000) },
    ];
    for (const body of bodies) {
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('メールアドレスの形をしていない入力は、認証サービスに問い合わせず、監査ログにも残さない（文言は同じ）', async () => {
    const response = await POST(request({ email: '<script>alert(1)</script>', password: 'x' }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: INVALID });
    expect(mocks.resolveLoginTarget).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.recordLoginFailure).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/login: 成功', () => {
  it('メールアドレスをそろえて（前後の空白・大文字）認証サービスに問い合わせ、ok を返す', async () => {
    const response = await POST(request({ email: '  Member@Example.com ', password: 'correct horse' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, mfa: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.signIn).toHaveBeenCalledWith({ email: 'member@example.com', password: 'correct horse' });
    // 成功は DB のトリガーが残すので、ここでは何も残さない
    expect(mocks.recordLoginFailure).not.toHaveBeenCalled();
  });

  it('パスワードの長さ・文字の種類は確かめない（決まりより前に作られたアカウントがある）', async () => {
    const response = await POST(request({ email: 'member@example.com', password: 'short1' }));
    expect(response.status).toBe(200);
    expect(mocks.signIn).toHaveBeenCalledWith({ email: 'member@example.com', password: 'short1' });
  });

  it('確認済みの要素がある人には、コードの確認が要ること（challenge）を伝える', async () => {
    mocks.signIn.mockResolvedValue({
      data: { user: { id: 'user-1', factors: [{ id: 'f1', status: 'verified', factor_type: 'totp' }] }, session: {} },
      error: null,
    });
    const response = await POST(request(credentials));
    await expect(response.json()).resolves.toEqual({ ok: true, mfa: 'challenge' });
  });

  it('登録の途中（確認前）の要素だけなら、コードは求めない', async () => {
    mocks.signIn.mockResolvedValue({
      data: { user: { id: 'user-1', factors: [{ id: 'f1', status: 'unverified', factor_type: 'totp' }] }, session: {} },
      error: null,
    });
    const response = await POST(request(credentials));
    await expect(response.json()).resolves.toEqual({ ok: true, mfa: 'ok' });
  });

  it('組織が必須にしていて、社内のロールで未登録なら、登録が要ること（enroll）を伝える。株主ロールは対象外', async () => {
    mocks.profile = { role: 'viewer', organizations: { requireMfaForInternal: true } };
    await expect((await POST(request(credentials))).json()).resolves.toEqual({ ok: true, mfa: 'enroll' });

    mocks.profile = { role: 'shareholder', organizations: { requireMfaForInternal: true } };
    await expect((await POST(request(credentials))).json()).resolves.toEqual({ ok: true, mfa: 'ok' });
  });
});

describe('POST /api/auth/login: 失敗の記録と一時停止', () => {
  const invalidCredentials = { data: { user: null, session: null }, error: { code: 'invalid_credentials', status: 400 } };

  it('パスワードの誤りは 401。理由だけを残し、パスワードは記録に渡さない', async () => {
    mocks.signIn.mockResolvedValue(invalidCredentials);
    mocks.getLoginLockout.mockResolvedValue({ ...NOT_LOCKED, failureCount: 2 });

    const response = await POST(request({ email: 'member@example.com', password: 'wrong-secret-password' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: INVALID, code: 'invalid_credentials' });
    expect(mocks.recordLoginFailure).toHaveBeenCalledTimes(1);
    const [, target, reason, failuresBefore] = mocks.recordLoginFailure.mock.calls[0];
    expect(target).toEqual({ email: 'member@example.com', userId: 'user-1', organizationId: 'org-1' });
    expect(reason).toBe('invalid_credentials');
    expect(failuresBefore).toBe(2);
    expect(JSON.stringify(mocks.recordLoginFailure.mock.calls)).not.toContain('wrong-secret-password');
    expect(JSON.stringify([mocks.warn.mock.calls, mocks.error.mock.calls])).not.toContain('wrong-secret-password');
  });

  it('存在しないメールアドレスでも、パスワードの誤りと同じ応答にする（有無を教えない）', async () => {
    mocks.signIn.mockResolvedValue(invalidCredentials);
    const known = await POST(request({ email: 'member@example.com', password: 'wrong' }));

    mocks.resolveLoginTarget.mockResolvedValue({ email: 'nobody@example.com', userId: null, organizationId: 'org-1' });
    const unknown = await POST(request({ email: 'nobody@example.com', password: 'wrong' }));

    expect(unknown.status).toBe(known.status);
    await expect(unknown.json()).resolves.toEqual(await known.json());
    expect(mocks.recordLoginFailure).toHaveBeenCalledTimes(2);
  });

  it('5 回目の失敗で止まったら、429 と止めた旨の文言を返す', async () => {
    mocks.signIn.mockResolvedValue(invalidCredentials);
    mocks.getLoginLockout.mockResolvedValue({ ...NOT_LOCKED, failureCount: 4 });
    mocks.recordLoginFailure.mockResolvedValue({ locked: true, lockedUntil: Date.now() + 15 * 60_000, failureCount: 5, lockRecorded: true });

    const response = await POST(request(credentials));

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, code: 'locked' });
    expect(body.error).toContain('一時的に停止');
    expect(body.error).toContain('約15分後');
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(890);
  });

  it('止めているあいだは、正しいパスワードでも認証サービスに問い合わせず、失敗としても残さない', async () => {
    const status = { locked: true, lockedUntil: Date.now() + 7 * 60_000, failureCount: 5, lockRecorded: true };
    mocks.getLoginLockout.mockResolvedValue(status);

    const response = await POST(request(credentials));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: 'locked', error: expect.stringContaining('約7分後') });
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.recordLoginFailure).not.toHaveBeenCalled();
    // 「止めた」記録がまだ無いときだけ残す、という判断は attemptLog に任せる
    expect(mocks.ensureLoginLockRecorded).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: 'member@example.com' }), status);
  });

  it('メールアドレスの確認がまだ・利用停止は、理由を残して、それぞれの文言を返す', async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'email_not_confirmed', status: 400 } });
    const unconfirmed = await POST(request(credentials));
    expect(unconfirmed.status).toBe(401);
    expect((await unconfirmed.json()).error).toContain('確認が完了していません');
    expect(mocks.recordLoginFailure.mock.calls[0][2]).toBe('email_not_confirmed');

    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'user_banned', status: 400 } });
    const banned = await POST(request(credentials));
    expect((await banned.json()).error).toContain('利用停止');
    expect(mocks.recordLoginFailure.mock.calls[1][2]).toBe('user_banned');
  });

  it('認証サービスの回数制限・通信の失敗は、本人の失敗として残さない（サーバのログに残す）', async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'over_request_rate_limit', status: 429 } });
    const limited = await POST(request(credentials));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toContain('試行回数が上限');

    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: {} });
    const network = await POST(request(credentials));
    expect(network.status).toBe(502);
    expect((await network.json()).error).toContain('通信に失敗');

    expect(mocks.recordLoginFailure).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(2);
  });

  it('同じ接続元からの失敗が上限に達したら、その接続元からの試行を 429 で止める（成功は数えない）', async () => {
    // 成功は何回しても数えない
    for (let i = 0; i < 5; i += 1) expect((await POST(request(credentials))).status).toBe(200);

    mocks.signIn.mockResolvedValue(invalidCredentials);
    for (let i = 0; i < IP_FAILURE_LIMIT; i += 1) {
      expect((await POST(request({ email: `user${i}@example.com`, password: 'wrong' }))).status).toBe(401);
    }
    mocks.resolveLoginTarget.mockClear();

    const blocked = await POST(request(credentials));
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toMatchObject({ code: 'rate_limited' });
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    expect(mocks.resolveLoginTarget).not.toHaveBeenCalled();

    // 別の接続元は止めない
    mocks.signIn.mockResolvedValue({ data: { user: { id: 'user-1', factors: [] }, session: {} }, error: null });
    expect((await POST(request(credentials, { 'x-forwarded-for': '198.51.100.9' }))).status).toBe(200);
  });
});
