import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Cookie セッション・使い捨てクライアント・admin client をすべてモックし、
// 「現在のパスワードの検証 → admin API で更新」の順序と、失敗時に更新へ進まないことを守る。
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  updateUserById: vi.fn(),
  recordAuditEventForUser: vi.fn<(userId: string, event: { action: string; outcome?: string }, admin?: unknown) => Promise<boolean>>(async () => true),
  mfa: 'ok' as 'ok' | 'challenge' | 'enroll',
}));

// セッションの状態（本人・二要素認証）は src/lib/sessionState.ts が読む。ここでは結果だけを差し替える
vi.mock('@/lib/sessionState', () => ({
  getSessionState: async () => {
    const { data } = await mocks.getUser();
    return {
      user: data.user ? { id: data.user.id, email: data.user.email ?? null, aal: 'aal1', factors: [] } : null,
      profile: null,
      mfa: mocks.mfa,
      requireMfaForInternal: false,
    };
  },
}));

// 監査ログへの記録は、DB に触れず呼び出しだけを確かめる
vi.mock('@/lib/audit/events', () => ({ recordAuditEventForUser: mocks.recordAuditEventForUser }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById: mocks.updateUserById } } }),
}));

import { PASSWORD_POLICY_ERROR } from '@/lib/security/passwordPolicy';
import { changePassword } from '../password';

describe('changePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mfa = 'ok';
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.com' } } });
    mocks.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.updateUserById.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('現在のパスワードを検証してから、セッションのユーザー自身を admin API で更新する', async () => {
    const result = await changePassword({ currentPassword: 'old-pass', newPassword: 'new-password-123' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.com', password: 'old-pass' });
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', { password: 'new-password-123' });
  });

  it('現在のパスワードが違えば更新しない', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid' } });

    const result = await changePassword({ currentPassword: 'wrong', newPassword: 'new-password-123' });

    expect(result).toEqual({ ok: false, error: '現在のパスワードが正しくありません' });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('未ログインなら検証も更新もしない', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const result = await changePassword({ currentPassword: 'old-pass', newPassword: 'new-password-123' });

    expect(result.ok).toBe(false);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('新パスワードが決まり（12 文字以上・英字と数字）を満たさなければ弾く（サーバ側でも検証する）', async () => {
    for (const weak of ['short', 'abcdefgh123', 'abcdefghijklmnop', '1234567890123456']) {
      const result = await changePassword({ currentPassword: 'old-pass', newPassword: weak });

      expect(result, weak).toEqual({ ok: false, error: PASSWORD_POLICY_ERROR });
    }
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('認証サービスが弱いパスワードとして拒否したら、決まりの文言を返す', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { code: 'weak_password', status: 422, message: 'weak' } });

    const result = await changePassword({ currentPassword: 'old-pass', newPassword: 'new-password-123' });

    expect(result).toEqual({ ok: false, error: PASSWORD_POLICY_ERROR });
  });

  it('二要素認証が済んでいないセッション（コードの確認待ち・必須なのに未登録）からは変更できない', async () => {
    for (const mfa of ['challenge', 'enroll'] as const) {
      mocks.mfa = mfa;
      const result = await changePassword({ currentPassword: 'old-pass', newPassword: 'new-password-123' });

      expect(result.ok, mfa).toBe(false);
    }
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('現在のパスワードの誤りと、変更の成功を監査ログに残す（パスワードは渡さない）', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: { message: 'Invalid' } });
    await changePassword({ currentPassword: 'wrong-current', newPassword: 'new-password-123' });
    await changePassword({ currentPassword: 'old-pass', newPassword: 'new-password-123' });

    expect(mocks.recordAuditEventForUser.mock.calls.map(([, event]) => [event.action, event.outcome ?? 'success'])).toEqual([
      ['auth.password.change', 'failure'],
      ['auth.password.change', 'success'],
    ]);
    const recorded = JSON.stringify(mocks.recordAuditEventForUser.mock.calls.map(([userId, event]) => [userId, event]));
    expect(recorded).not.toContain('new-password-123');
    expect(recorded).not.toContain('wrong-current');
  });

  it('admin API が失敗したらエラーを返す', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const result = await changePassword({ currentPassword: 'old-pass', newPassword: 'new-password-123' });

    expect(result).toEqual({ ok: false, error: 'パスワードの更新に失敗しました' });
  });
});
