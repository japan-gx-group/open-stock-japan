import { beforeEach, describe, expect, it, vi } from 'vitest';

// 自分の二要素認証の登録・解除。セッションの状態・認証サービス・本人確認・監査ログをモックする。
const mocks = vi.hoisted(() => ({
  session: null as unknown,
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  refreshSession: vi.fn(),
  verifyCurrentPassword: vi.fn(),
  recordAuditEvent: vi.fn(async () => true),
  getMfaLockout: vi.fn(),
  ensureMfaLockRecorded: vi.fn(async () => undefined),
  recordMfaFailure: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/sessionState', () => ({ readSessionState: async () => mocks.session }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock('@/lib/audit/events', () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('@/lib/logging/logger', () => ({ logger: { warn: mocks.warn, error: vi.fn() } }));
vi.mock('@/lib/reauth', () => ({ verifyCurrentPassword: mocks.verifyCurrentPassword }));
vi.mock('@/features/auth/services/authServerClient', () => ({
  createAuthServerClient: async () => ({
    auth: {
      refreshSession: mocks.refreshSession,
      mfa: { enroll: mocks.enroll, unenroll: mocks.unenroll, challengeAndVerify: mocks.challengeAndVerify },
    },
  }),
}));
vi.mock('@/features/auth/services/attemptLog', () => ({
  getMfaLockout: mocks.getMfaLockout,
  ensureMfaLockRecorded: mocks.ensureMfaLockRecorded,
  recordMfaFailure: mocks.recordMfaFailure,
}));

import { cancelMfaEnrollment, confirmMfaEnrollment, getMfaOverview, removeMfaFactor, startMfaEnrollment } from '../mfa';

const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';
const PENDING = '33333333-3333-4333-8333-333333333333';
const NOT_LOCKED = { locked: false, lockedUntil: null, failureCount: 0, lockRecorded: false };

const factor = (id: string, status: 'verified' | 'unverified', name = '認証アプリ') => ({
  id,
  status,
  factor_type: 'totp',
  friendly_name: name,
  created_at: '2026-11-11T00:00:00Z',
});

const session = (options: { factors?: unknown[]; mfa?: string; role?: string; required?: boolean; profile?: boolean } = {}) => ({
  user: { id: 'user-1', email: 'u@example.com', aal: 'aal2', factors: options.factors ?? [] },
  profile:
    options.profile === false
      ? null
      : { id: 'user-1', organizationId: 'org-1', email: 'u@example.com', fullName: null, role: options.role ?? 'logger', stakeholderId: null },
  mfa: options.mfa ?? 'ok',
  requireMfaForInternal: options.required ?? false,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = session();
  mocks.getMfaLockout.mockResolvedValue(NOT_LOCKED);
  mocks.recordMfaFailure.mockResolvedValue({ ...NOT_LOCKED, failureCount: 1 });
  mocks.enroll.mockResolvedValue({
    data: { id: PENDING, type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg fill="#000"></svg>', secret: 'SECRETSECRET', uri: 'otpauth://totp/x' } },
    error: null,
  });
  mocks.unenroll.mockResolvedValue({ data: {}, error: null });
  mocks.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  mocks.refreshSession.mockResolvedValue({ data: {}, error: null });
  mocks.verifyCurrentPassword.mockResolvedValue(true);
});

describe('セッションの条件', () => {
  it('未ログイン・コードの確認待ち（challenge）のセッションからは、どの操作もできない', async () => {
    for (const state of [{ user: null, profile: null, mfa: 'ok', requireMfaForInternal: false }, session({ mfa: 'challenge', factors: [factor(F1, 'verified')] })]) {
      mocks.session = state;
      expect((await getMfaOverview()).ok).toBe(false);
      expect((await startMfaEnrollment()).ok).toBe(false);
      expect((await confirmMfaEnrollment({ factorId: PENDING, code: '123456' })).ok).toBe(false);
      expect((await removeMfaFactor({ factorId: F1, currentPassword: 'pw' })).ok).toBe(false);
    }
    expect(mocks.enroll).not.toHaveBeenCalled();
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
    expect(mocks.unenroll).not.toHaveBeenCalled();
  });

  it('必須なのに未登録（enroll）の人は、登録だけできる', async () => {
    mocks.session = session({ mfa: 'enroll', required: true });
    expect((await startMfaEnrollment()).ok).toBe(true);
    expect((await getMfaOverview()).ok).toBe(true);
  });
});

describe('getMfaOverview', () => {
  it('確認済みの機器だけを返す。組織の必須は、社内のロールにだけ当てはまる', async () => {
    mocks.session = session({ factors: [factor(F1, 'verified', '仕事用'), factor(PENDING, 'unverified', '途中')], required: true });
    await expect(getMfaOverview()).resolves.toEqual({
      ok: true,
      data: { factors: [{ id: F1, name: '仕事用', createdAt: '2026-11-11T00:00:00Z' }], required: true, maxFactors: 2 },
    });

    mocks.session = session({ role: 'shareholder', required: true });
    await expect(getMfaOverview()).resolves.toMatchObject({ data: { factors: [], required: false } });
  });
});

describe('startMfaEnrollment', () => {
  it('QR コードと秘密の値を返す。QR コードは img に入れられるようエンコードし直す', async () => {
    const result = await startMfaEnrollment({ name: '  仕事用のスマートフォン  ' });
    expect(result).toEqual({
      ok: true,
      data: {
        factorId: PENDING,
        qrCode: `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg fill="#000"></svg>')}`,
        secret: 'SECRETSECRET',
      },
    });
    expect(mocks.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: '仕事用のスマートフォン', issuer: 'OpenStock Japan' });
    // 登録の開始は認証サービスが残す。秘密の値は、ログにも監査ログにも渡さない
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('SECRETSECRET');
  });

  it('途中でやめた登録（確認前の要素）を先に消してから始める', async () => {
    mocks.session = session({ factors: [factor(F1, 'verified'), factor(PENDING, 'unverified')] });
    await startMfaEnrollment();
    expect(mocks.unenroll).toHaveBeenCalledTimes(1);
    expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: PENDING });
  });

  it('名前が重なるときは番号を足す（同じ名前では登録できない）', async () => {
    mocks.session = session({ factors: [factor(F1, 'verified', '認証アプリ')] });
    await startMfaEnrollment({});
    expect(mocks.enroll).toHaveBeenCalledWith(expect.objectContaining({ friendlyName: '認証アプリ 2' }));
  });

  it('登録できるのは 2 台まで', async () => {
    mocks.session = session({ factors: [factor(F1, 'verified', 'a'), factor(F2, 'verified', 'b')] });
    const result = await startMfaEnrollment();
    expect(result).toEqual({ ok: false, error: expect.stringContaining('2台まで') });
    expect(mocks.enroll).not.toHaveBeenCalled();
  });
});

describe('confirmMfaEnrollment', () => {
  beforeEach(() => {
    mocks.session = session({ factors: [factor(PENDING, 'unverified', '仕事用')] });
  });

  it('正しいコードで登録が完了し、auth.mfa.enroll を残す（コード・秘密の値は残さない）', async () => {
    const result = await confirmMfaEnrollment({ factorId: PENDING, code: '123 456' });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.challengeAndVerify).toHaveBeenCalledWith({ factorId: PENDING, code: '123456' });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: 'user-1' },
      { action: 'auth.mfa.enroll', entityName: 'auth.users', entityId: 'user-1', detail: { factorId: PENDING, name: '仕事用', factorCount: 1 } },
      { admin: true },
    );
    expect(JSON.stringify(mocks.recordAuditEvent.mock.calls)).not.toContain('123456');
  });

  it('コードが違えば、失敗を残して弾く（登録は完了しない）', async () => {
    mocks.challengeAndVerify.mockResolvedValue({ error: { code: 'mfa_verification_failed', status: 422 } });
    const result = await confirmMfaEnrollment({ factorId: PENDING, code: '000000' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('コードが正しくありません') });
    expect(mocks.recordMfaFailure).toHaveBeenCalledWith({ admin: true }, { organizationId: 'org-1', userId: 'user-1' }, 'enroll', 0);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('止めているあいだは、認証サービスに問い合わせない', async () => {
    mocks.getMfaLockout.mockResolvedValue({ locked: true, lockedUntil: Date.now() + 60_000, failureCount: 5, lockRecorded: true });
    const result = await confirmMfaEnrollment({ factorId: PENDING, code: '123456' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('一時的に停止') });
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('自分の確認前の要素でなければ弾く（他人の要素・確認済みの要素・形の違う id）', async () => {
    for (const factorId of [F1, 'not-a-uuid']) {
      expect((await confirmMfaEnrollment({ factorId, code: '123456' })).ok).toBe(false);
    }
    mocks.session = session({ factors: [factor(F1, 'verified')] });
    expect((await confirmMfaEnrollment({ factorId: F1, code: '123456' })).ok).toBe(false);
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('コードが 6 桁の数字でなければ弾く', async () => {
    const result = await confirmMfaEnrollment({ factorId: PENDING, code: '12345' });
    expect(result).toEqual({ ok: false, error: 'コードは6桁の数字で入力してください。' });
  });
});

describe('cancelMfaEnrollment', () => {
  it('確認前の要素だけを消す。確認済みの要素は消さない', async () => {
    mocks.session = session({ factors: [factor(F1, 'verified'), factor(PENDING, 'unverified')] });
    await cancelMfaEnrollment({ factorId: PENDING });
    expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: PENDING });

    mocks.unenroll.mockClear();
    await expect(cancelMfaEnrollment({ factorId: F1 })).resolves.toEqual({ ok: true, data: undefined });
    await cancelMfaEnrollment({ factorId: 'unknown' });
    expect(mocks.unenroll).not.toHaveBeenCalled();
  });
});

describe('removeMfaFactor', () => {
  beforeEach(() => {
    mocks.session = session({ factors: [factor(F1, 'verified', '仕事用'), factor(F2, 'verified', '予備')] });
  });

  it('現在のパスワードを確かめてから解除し、セッションを取り直す', async () => {
    const result = await removeMfaFactor({ factorId: F2, currentPassword: 'current-pw' });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.verifyCurrentPassword).toHaveBeenCalledWith('u@example.com', 'current-pw');
    expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: F2 });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    // 解除の成功は認証サービスが残す（auth.factor_unenrolled）。ここでは重ねて残さない
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('パスワードが違えば解除せず、失敗を残す（パスワードは残さない）', async () => {
    mocks.verifyCurrentPassword.mockResolvedValue(false);
    const result = await removeMfaFactor({ factorId: F2, currentPassword: 'wrong-pw-value' });
    expect(result).toEqual({ ok: false, error: '現在のパスワードが正しくありません' });
    expect(mocks.unenroll).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: 'user-1' },
      {
        action: 'auth.mfa.unenroll',
        entityName: 'auth.users',
        entityId: 'user-1',
        detail: { reason: 'current_password_mismatch', factorId: F2 },
        outcome: 'failure',
      },
    );
    expect(JSON.stringify(mocks.recordAuditEvent.mock.calls)).not.toContain('wrong-pw-value');
  });

  it('組織が必須にしているとき、社内のロールは最後の 1 台を解除できない', async () => {
    mocks.session = session({ factors: [factor(F1, 'verified')], required: true });
    const result = await removeMfaFactor({ factorId: F1, currentPassword: 'current-pw' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('最後の1台は解除できません') });
    expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled();
    expect(mocks.unenroll).not.toHaveBeenCalled();
  });

  it('必須でも、予備がある（2 台）なら 1 台は解除できる。株主ロールは最後の 1 台も解除できる', async () => {
    mocks.session = session({ factors: [factor(F1, 'verified'), factor(F2, 'verified')], required: true });
    expect((await removeMfaFactor({ factorId: F1, currentPassword: 'current-pw' })).ok).toBe(true);

    mocks.session = session({ factors: [factor(F1, 'verified')], required: true, role: 'shareholder' });
    expect((await removeMfaFactor({ factorId: F1, currentPassword: 'current-pw' })).ok).toBe(true);
  });

  it('自分の確認済みの要素でなければ弾く。パスワードが空でも弾く', async () => {
    expect((await removeMfaFactor({ factorId: PENDING, currentPassword: 'current-pw' })).ok).toBe(false);
    expect((await removeMfaFactor({ factorId: 'not-a-uuid', currentPassword: 'current-pw' })).ok).toBe(false);
    expect((await removeMfaFactor({ factorId: F1, currentPassword: '' })).ok).toBe(false);
    expect(mocks.unenroll).not.toHaveBeenCalled();
  });

  it('必須なのに未登録（enroll）のセッションからは解除できない（解除は確認済みのセッションだけ）', async () => {
    mocks.session = session({ factors: [], mfa: 'enroll', required: true });
    expect((await removeMfaFactor({ factorId: F1, currentPassword: 'current-pw' })).ok).toBe(false);
    expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled();
  });
});
