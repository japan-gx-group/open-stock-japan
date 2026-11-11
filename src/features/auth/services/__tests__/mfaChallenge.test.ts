import { beforeEach, describe, expect, it, vi } from 'vitest';

// ログイン時のコードの確認。セッションの状態・認証サービス・失敗の記録をモックする。
const mocks = vi.hoisted(() => ({
  session: null as unknown,
  challengeAndVerify: vi.fn(),
  getMfaLockout: vi.fn(),
  ensureMfaLockRecorded: vi.fn(async () => undefined),
  recordMfaFailure: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/sessionState', () => ({ readSessionState: async () => mocks.session }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock('@/lib/logging/logger', () => ({ logger: { warn: mocks.warn, error: vi.fn() } }));
vi.mock('@/features/auth/services/authServerClient', () => ({
  createAuthServerClient: async () => ({ auth: { mfa: { challengeAndVerify: mocks.challengeAndVerify } } }),
}));
vi.mock('@/features/auth/services/attemptLog', () => ({
  getMfaLockout: mocks.getMfaLockout,
  ensureMfaLockRecorded: mocks.ensureMfaLockRecorded,
  recordMfaFailure: mocks.recordMfaFailure,
}));

import { verifyMfaChallenge } from '../mfaChallenge';

const NOT_LOCKED = { locked: false, lockedUntil: null, failureCount: 0, lockRecorded: false };
const WRONG = { error: { code: 'mfa_verification_failed', status: 422 } };
const factor = (id: string, status = 'verified', factorType = 'totp') => ({ id, status, factor_type: factorType });
const profile = { id: 'user-1', organizationId: 'org-1', email: 'u@example.com', fullName: null, role: 'logger', stakeholderId: null };

const challengeSession = (factors: unknown[] = [factor('f1')]) => ({
  user: { id: 'user-1', email: 'u@example.com', aal: 'aal1', factors },
  profile,
  mfa: 'challenge',
  requireMfaForInternal: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = challengeSession();
  mocks.getMfaLockout.mockResolvedValue(NOT_LOCKED);
  mocks.recordMfaFailure.mockResolvedValue({ ...NOT_LOCKED, failureCount: 1 });
  mocks.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
});

describe('verifyMfaChallenge', () => {
  it('6 桁の数字でなければ、何も問い合わせずに弾く', async () => {
    for (const code of ['', '12345', 'abcdef', '1234567']) {
      const result = await verifyMfaChallenge({ code });
      expect(result).toEqual({ ok: false, error: 'コードは6桁の数字で入力してください。' });
    }
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('未ログインなら弾く', async () => {
    mocks.session = { user: null, profile: null, mfa: 'ok', requireMfaForInternal: false };
    const result = await verifyMfaChallenge({ code: '123456' });
    expect(result.ok).toBe(false);
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('もう確認済みなら、問い合わせずに成功を返す', async () => {
    mocks.session = { ...challengeSession(), mfa: 'ok' };
    await expect(verifyMfaChallenge({ code: '123456' })).resolves.toEqual({ ok: true, data: undefined });
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('正しいコードなら成功（空白・全角はそろえる）。失敗は残さない', async () => {
    await expect(verifyMfaChallenge({ code: ' １２３ ４５６ ' })).resolves.toEqual({ ok: true, data: undefined });
    expect(mocks.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' });
    expect(mocks.recordMfaFailure).not.toHaveBeenCalled();
  });

  it('機器が複数あるときは、どの機器のコードでも通る（確認済みの TOTP だけを順に試す）', async () => {
    mocks.session = challengeSession([factor('f0', 'unverified'), factor('f1'), factor('f2'), factor('phone', 'verified', 'phone')]);
    mocks.challengeAndVerify.mockResolvedValueOnce(WRONG).mockResolvedValueOnce({ data: {}, error: null });

    await expect(verifyMfaChallenge({ code: '123456' })).resolves.toEqual({ ok: true, data: undefined });
    expect(mocks.challengeAndVerify.mock.calls.map(([args]) => args.factorId)).toEqual(['f1', 'f2']);
    expect(mocks.recordMfaFailure).not.toHaveBeenCalled();
  });

  it('どの機器でも通らなければ、失敗を 1 回だけ残す（コードは渡さない）', async () => {
    mocks.session = challengeSession([factor('f1'), factor('f2')]);
    mocks.challengeAndVerify.mockResolvedValue(WRONG);
    mocks.getMfaLockout.mockResolvedValue({ ...NOT_LOCKED, failureCount: 2 });

    const result = await verifyMfaChallenge({ code: '987654' });

    expect(result).toEqual({ ok: false, error: expect.stringContaining('コードが正しくありません') });
    expect(mocks.recordMfaFailure).toHaveBeenCalledTimes(1);
    expect(mocks.recordMfaFailure).toHaveBeenCalledWith({ admin: true }, { organizationId: 'org-1', userId: 'user-1' }, 'login', 2);
    expect(JSON.stringify(mocks.recordMfaFailure.mock.calls)).not.toContain('987654');
  });

  it('5 回目の失敗で止まったら、止めた旨を返す', async () => {
    mocks.challengeAndVerify.mockResolvedValue(WRONG);
    mocks.recordMfaFailure.mockResolvedValue({ locked: true, lockedUntil: Date.now() + 15 * 60_000, failureCount: 5, lockRecorded: true });
    const result = await verifyMfaChallenge({ code: '123456' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('一時的に停止') });
  });

  it('止めているあいだは、正しいコードでも認証サービスに問い合わせない', async () => {
    const status = { locked: true, lockedUntil: Date.now() + 5 * 60_000, failureCount: 5, lockRecorded: false };
    mocks.getMfaLockout.mockResolvedValue(status);

    const result = await verifyMfaChallenge({ code: '123456' });

    expect(result).toEqual({ ok: false, error: expect.stringContaining('約5分後') });
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
    expect(mocks.recordMfaFailure).not.toHaveBeenCalled();
    expect(mocks.ensureMfaLockRecorded).toHaveBeenCalledWith({ admin: true }, { organizationId: 'org-1', userId: 'user-1' }, status);
  });

  it('コードの誤り以外のエラー（回数制限・通信）は、失敗に数えない', async () => {
    mocks.challengeAndVerify.mockResolvedValue({ error: { code: 'over_request_rate_limit', status: 429 } });
    const result = await verifyMfaChallenge({ code: '123456' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('確認できませんでした') });
    expect(mocks.recordMfaFailure).not.toHaveBeenCalled();
  });

  it('確認済みの要素が無い（登録が要る状態）なら弾く', async () => {
    mocks.session = { ...challengeSession([]), mfa: 'enroll' };
    const result = await verifyMfaChallenge({ code: '123456' });
    expect(result.ok).toBe(false);
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('プロフィールの無いアカウントは、記録先が無いので確認だけ行う', async () => {
    mocks.session = { ...challengeSession(), profile: null };
    mocks.challengeAndVerify.mockResolvedValue(WRONG);
    const result = await verifyMfaChallenge({ code: '123456' });
    expect(result.ok).toBe(false);
    expect(mocks.getMfaLockout).not.toHaveBeenCalled();
    expect(mocks.recordMfaFailure).not.toHaveBeenCalled();
  });
});
