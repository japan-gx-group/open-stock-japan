import { beforeEach, describe, expect, it, vi } from 'vitest';

// セッションの状態の読み取り。Cookie のセッション・認証サービス・DB をモックし、
//   - 本人と要素は、認証サービスにトークンを渡して取り直した値を使う（Cookie の中身は信用しない）
//   - aal は、認証サービスが受け付けた、その同じトークンから読む
//   - getCurrentProfile() は、二要素認証が済んでいないとき null を返す
// を確かめる。
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  profileRow: null as unknown,
  profileError: null as unknown,
  createAdminClient: vi.fn(),
  route: 'GET /shareholders' as string | null,
  error: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getSession: mocks.getSession, getUser: mocks.getUser } }),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

vi.mock('@/lib/audit/requestContext', () => ({
  readAuditRequestContext: async () => ({ actorId: null, ip: null, userAgent: null, requestId: null, route: mocks.route }),
}));

vi.mock('@/lib/logging/logger', () => ({ logger: { error: mocks.error, warn: vi.fn() } }));

import { getCurrentProfile } from '../currentProfile';
import { getMfaRedirect, readSessionState } from '../sessionState';

const token = (aal: string | undefined): string => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ sub: 'user-1', ...(aal ? { aal } : {}) })}.sig`;
};

const row = (role: string, requireMfaForInternal: boolean) => ({
  id: 'user-1',
  organizationId: 'org-1',
  email: 'user@example.com',
  fullName: '山田 太郎',
  role,
  stakeholderId: null,
  organizations: { requireMfaForInternal },
});

const factor = (status: 'verified' | 'unverified') => ({ id: `factor-${status}`, status, factor_type: 'totp', friendly_name: '認証アプリ', created_at: '2026-11-11T00:00:00Z' });

const signedIn = (aal: string | undefined, factors: unknown[] = []) => {
  const accessToken = token(aal);
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: accessToken } } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.com', factors } }, error: null });
  return accessToken;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.route = 'GET /shareholders';
  mocks.profileRow = row('logger', false);
  mocks.profileError = null;
  mocks.createAdminClient.mockImplementation(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profileRow, error: mocks.profileError }) }) }),
    }),
  }));
});

describe('readSessionState', () => {
  it('セッションが無ければ未ログイン（認証サービスにも DB にも問い合わせない）', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(readSessionState()).resolves.toEqual({ user: null, profile: null, mfa: 'ok', requireMfaForInternal: false });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('Cookie のトークンを認証サービスが受け付けなければ未ログイン（偽造・失効したトークン）', async () => {
    // 中身を aal2 に書き換えたトークンでも、認証サービスが受け付けなければ使わない
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: token('aal2') } } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    const state = await readSessionState();
    expect(state.user).toBeNull();
    expect(state.profile).toBeNull();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('認証サービスには、Cookie から取り出したその同じトークンを渡して確かめる', async () => {
    const accessToken = signedIn('aal1');
    await readSessionState();
    expect(mocks.getUser).toHaveBeenCalledWith(accessToken);
  });

  it('要素なし・組織の必須なし → ok。プロフィールを返す', async () => {
    signedIn('aal1');
    const state = await readSessionState();
    expect(state.mfa).toBe('ok');
    expect(state.user).toMatchObject({ id: 'user-1', email: 'user@example.com', aal: 'aal1', factors: [] });
    expect(state.profile).toEqual({
      id: 'user-1',
      organizationId: 'org-1',
      email: 'user@example.com',
      fullName: '山田 太郎',
      role: 'logger',
      stakeholderId: null,
    });
  });

  it('確認済みの要素があるのに aal1 → challenge（プロフィールは読めるが、権限には使わせない）', async () => {
    signedIn('aal1', [factor('verified')]);
    const state = await readSessionState();
    expect(state.mfa).toBe('challenge');
    expect(state.profile?.role).toBe('logger');
  });

  it('確認済みの要素があり aal2 → ok', async () => {
    signedIn('aal2', [factor('verified')]);
    await expect(readSessionState()).resolves.toMatchObject({ mfa: 'ok' });
  });

  it('トークンに aal が無ければ、確認していない扱い', async () => {
    signedIn(undefined, [factor('verified')]);
    await expect(readSessionState()).resolves.toMatchObject({ mfa: 'challenge' });
  });

  it('登録の途中（確認前）の要素は数えない', async () => {
    signedIn('aal1', [factor('unverified')]);
    await expect(readSessionState()).resolves.toMatchObject({ mfa: 'ok' });
  });

  it('組織が必須にしていて、社内のロールで未登録 → enroll。株主ロールは ok', async () => {
    signedIn('aal1');
    mocks.profileRow = row('viewer', true);
    await expect(readSessionState()).resolves.toMatchObject({ mfa: 'enroll', requireMfaForInternal: true });

    mocks.profileRow = row('shareholder', true);
    await expect(readSessionState()).resolves.toMatchObject({ mfa: 'ok', requireMfaForInternal: true });
  });

  it('埋め込み（organizations）が配列で返っても読める', async () => {
    signedIn('aal1');
    mocks.profileRow = { ...row('admin', false), organizations: [{ requireMfaForInternal: true }] };
    await expect(readSessionState()).resolves.toMatchObject({ mfa: 'enroll' });
  });

  it('プロフィールが無い・ロールが想定外・DB エラーのときは、プロフィールなし（権限なし）に倒す', async () => {
    signedIn('aal1');
    mocks.profileRow = null;
    await expect(readSessionState()).resolves.toMatchObject({ profile: null, mfa: 'ok' });

    mocks.profileRow = row('superuser', false);
    await expect(readSessionState()).resolves.toMatchObject({ profile: null });

    mocks.profileRow = row('admin', false);
    mocks.profileError = { message: 'column organizations.requireMfaForInternal does not exist' };
    await expect(readSessionState()).resolves.toMatchObject({ profile: null });
    expect(mocks.error).toHaveBeenCalled();
  });

  it('service_role の設定が無く管理クライアントを作れないときも、例外にせず権限なしに倒す', async () => {
    signedIn('aal1');
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY が必要です');
    });
    const state = await readSessionState();
    expect(state.user?.id).toBe('user-1');
    expect(state.profile).toBeNull();
  });
});

describe('getCurrentProfile', () => {
  it('二要素認証が済んでいれば、プロフィールを返す', async () => {
    signedIn('aal2', [factor('verified')]);
    await expect(getCurrentProfile()).resolves.toMatchObject({ id: 'user-1', role: 'logger' });
  });

  it('未ログインなら null', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(getCurrentProfile()).resolves.toBeNull();
  });

  it('(a) 確認済みの要素があるのに aal2 でないセッションは null（= API・Server Action は 401）', async () => {
    signedIn('aal1', [factor('verified')]);
    await expect(getCurrentProfile()).resolves.toBeNull();
  });

  it('(b) 組織が必須にしていて、社内のロールの本人が未登録なら null', async () => {
    signedIn('aal1');
    for (const role of ['admin', 'logger', 'viewer']) {
      mocks.profileRow = row(role, true);
      await expect(getCurrentProfile(), role).resolves.toBeNull();
    }
  });

  it('組織が必須にしていても、未登録の株主ロールは通す', async () => {
    signedIn('aal1');
    mocks.profileRow = row('shareholder', true);
    await expect(getCurrentProfile()).resolves.toMatchObject({ role: 'shareholder' });
  });
});

describe('getMfaRedirect', () => {
  const state = (mfa: 'ok' | 'challenge' | 'enroll', user = true) => ({
    user: user ? { id: 'user-1', email: null, aal: 'aal1' as const, factors: [] } : null,
    profile: null,
    mfa,
    requireMfaForInternal: false,
  });

  it('済んでいる・未ログインなら null（送らない）', async () => {
    await expect(getMfaRedirect(state('ok'))).resolves.toBeNull();
    await expect(getMfaRedirect(state('challenge', false))).resolves.toBeNull();
  });

  it('確認がまだなら /mfa、未登録なら /mfa/setup へ。開こうとした画面を next で引き継ぐ', async () => {
    await expect(getMfaRedirect(state('challenge'))).resolves.toBe('/mfa?next=%2Fshareholders');
    await expect(getMfaRedirect(state('enroll'))).resolves.toBe('/mfa/setup?next=%2Fshareholders');
  });

  it('画面の表示（GET）でないとき・パスが分からないときは、next を付けない', async () => {
    mocks.route = 'POST /shareholders';
    await expect(getMfaRedirect(state('challenge'))).resolves.toBe('/mfa');
    mocks.route = null;
    await expect(getMfaRedirect(state('enroll'))).resolves.toBe('/mfa/setup');
  });
});
