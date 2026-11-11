import { beforeEach, describe, expect, it, vi } from 'vitest';

// 本人確認（ログイン中の、パスワードの再入力）。失敗を数え、続いたら認証サービスを呼ばずに断ることを確かめる。
// 公開前のセキュリティの点検で、ここに回数の制限が無く、ログイン中のセッションを手に入れた人が
// パスワードを何度でも試せることが分かった。

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  resolveLoginTarget: vi.fn(),
  getReauthLockout: vi.fn(),
  recordReauthFailure: vi.fn(async () => ({ locked: false })),
  error: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock('@/features/auth/services/attemptLog', () => ({
  resolveLoginTarget: mocks.resolveLoginTarget,
  getReauthLockout: mocks.getReauthLockout,
  recordReauthFailure: mocks.recordReauthFailure,
}));
vi.mock('@/lib/logging/logger', () => ({ logger: { error: mocks.error, warn: vi.fn() } }));

import { verifyCurrentPassword } from '../reauth';

const subject = { organizationId: 'org-1', userId: 'user-1' };

describe('verifyCurrentPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    mocks.resolveLoginTarget.mockResolvedValue({ email: 'member@example.com', ...subject });
    mocks.getReauthLockout.mockResolvedValue({ locked: false, lockedUntil: null, failureCount: 2, lockRecorded: false });
    mocks.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
  });

  it('正しいパスワードなら true。失敗は記録しない', async () => {
    await expect(verifyCurrentPassword('Member@Example.com ', 'correct')).resolves.toBe(true);
    // 数える相手は、小文字にそろえたメールアドレスから決める
    expect(mocks.resolveLoginTarget).toHaveBeenCalledWith(expect.anything(), 'member@example.com');
    expect(mocks.recordReauthFailure).not.toHaveBeenCalled();
  });

  it('誤ったパスワードなら false で、失敗を（それまでの回数と合わせて）記録する', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } });
    await expect(verifyCurrentPassword('member@example.com', 'wrong')).resolves.toBe(false);
    expect(mocks.recordReauthFailure).toHaveBeenCalledWith(expect.anything(), subject, 2);
  });

  it('失敗が続いて止めているあいだは、認証サービスを呼ばずに false（正しいパスワードでも通さない）', async () => {
    mocks.getReauthLockout.mockResolvedValue({ locked: true, lockedUntil: Date.now() + 60_000, failureCount: 5, lockRecorded: true });
    await expect(verifyCurrentPassword('member@example.com', 'correct')).resolves.toBe(false);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.recordReauthFailure).not.toHaveBeenCalled();
  });

  it('回数を確かめられなかったときは、確認なしで続ける（だれも本人確認できなくなるのを避け、サーバのログに残す）', async () => {
    mocks.resolveLoginTarget.mockRejectedValue(new Error('db down'));
    await expect(verifyCurrentPassword('member@example.com', 'correct')).resolves.toBe(true);
    expect(mocks.error).toHaveBeenCalled();
  });

  it('入力されたパスワードを、失敗の記録に渡さない', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } });
    await verifyCurrentPassword('member@example.com', 'p@ssw0rd-secret');
    expect(JSON.stringify(mocks.recordReauthFailure.mock.calls)).not.toContain('p@ssw0rd-secret');
  });
});
