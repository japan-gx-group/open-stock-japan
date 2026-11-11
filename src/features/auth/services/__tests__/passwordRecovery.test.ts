import { beforeEach, describe, expect, it, vi } from 'vitest';

// next/headers の cookies()・Cookie セッション・admin client をモックし、
// 「マーカー Cookie があり、かつメールのリンクを踏んで入ってきたセッションのときだけ更新し、更新後にマーカーを消す」ことを守る。
// とくに、パスワードでログインしただけのセッションが、マーカー Cookie を自分で付けても通れないこと
// （公開前のセキュリティの点検で、Cookie だけで通れてしまうことが分かった）。
const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  updateUserById: vi.fn(),
  recordAuditEventForUser: vi.fn(async () => true),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, delete: mocks.cookieDelete }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getSession: mocks.getSession, getUser: mocks.getUser } }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById: mocks.updateUserById } } }),
}));

// 監査ログへの記録は、DB に触れず呼び出しだけを確かめる
vi.mock('@/lib/audit/events', () => ({ recordAuditEventForUser: mocks.recordAuditEventForUser }));

import { PASSWORD_POLICY_ERROR } from '@/lib/security/passwordPolicy';
import { completePasswordRecovery } from '../passwordRecovery';

// 認証サービスが出すアクセストークンの形（署名の部分は、このテストでは見ない）
const tokenWith = (amr: unknown): string => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ sub: 'user-1', aal: 'aal1', amr })}.signature`;
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const recoveryToken = () => tokenWith([{ method: 'otp', timestamp: nowSeconds() - 30 }]);
const passwordLoginToken = () => tokenWith([{ method: 'password', timestamp: nowSeconds() - 30 }]);

describe('completePasswordRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ name: 'openstock-pw-recovery', value: '1' });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: recoveryToken() } } });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mocks.updateUserById.mockResolvedValue({ data: {}, error: null });
  });

  it('マーカーと recovery セッションが揃っていれば更新し、マーカーを消す', async () => {
    const result = await completePasswordRecovery('new-password-123');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.cookieGet).toHaveBeenCalledWith('openstock-pw-recovery');
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', { password: 'new-password-123' });
    expect(mocks.cookieDelete).toHaveBeenCalledWith('openstock-pw-recovery');
    // 再設定したという事実だけを残す（パスワードは渡さない）
    expect(mocks.recordAuditEventForUser).toHaveBeenCalledWith(
      'user-1',
      { action: 'auth.password.reset', entityName: 'auth.users', entityId: 'user-1' },
      expect.anything(),
    );
  });

  it('マーカー Cookie が無ければ更新しない（ただログイン中の人からの呼び出し）', async () => {
    mocks.cookieGet.mockReturnValue(undefined);

    const result = await completePasswordRecovery('new-password-123');

    expect(result.ok).toBe(false);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it('セッションが無い・認証サービスがトークンを受け付けないときは更新しない', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await completePasswordRecovery('new-password-123')).ok).toBe(false);

    mocks.getSession.mockResolvedValue({ data: { session: null } });
    expect((await completePasswordRecovery('new-password-123')).ok).toBe(false);

    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('認証サービスには、Cookie のアクセストークンそのものを渡して確かめる（Cookie の中の user を信じない）', async () => {
    const token = recoveryToken();
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: token, user: { id: 'someone-else' } } } });

    await completePasswordRecovery('new-password-123');

    expect(mocks.getUser).toHaveBeenCalledWith(token);
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', { password: 'new-password-123' });
  });

  it('パスワードでログインしただけのセッションは、マーカー Cookie を付けても更新できない（拒否を監査ログに残す）', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: passwordLoginToken() } } });

    const result = await completePasswordRecovery('new-password-123');

    expect(result.ok).toBe(false);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
    expect(mocks.recordAuditEventForUser).toHaveBeenCalledWith('user-1', {
      action: 'auth.password.reset',
      entityName: 'auth.users',
      entityId: 'user-1',
      detail: { reason: 'not_recovery_session' },
      outcome: 'denied',
    });
  });

  it('メールのリンクを踏んでから時間が経ちすぎたセッションでは更新できない', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: tokenWith([{ method: 'otp', timestamp: nowSeconds() - 16 * 60 }]) } },
    });

    const result = await completePasswordRecovery('new-password-123');

    expect(result.ok).toBe(false);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('パスワードの決まり（12 文字以上・英字と数字）を満たさなければ弾く', async () => {
    for (const weak of ['short', 'abcdefgh123', 'abcdefghijklmnop', '1234567890123456']) {
      const result = await completePasswordRecovery(weak);

      expect(result, weak).toEqual({ ok: false, error: PASSWORD_POLICY_ERROR });
    }
    expect(mocks.cookieGet).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('認証サービスが弱いパスワードとして拒否したら、決まりの文言を返す', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { code: 'weak_password', status: 422, message: 'weak' } });

    const result = await completePasswordRecovery('new-password-123');

    expect(result).toEqual({ ok: false, error: PASSWORD_POLICY_ERROR });
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it('admin API が失敗したらマーカーを残したままエラーを返す', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const result = await completePasswordRecovery('new-password-123');

    expect(result).toEqual({ ok: false, error: 'パスワードの更新に失敗しました' });
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });
});
