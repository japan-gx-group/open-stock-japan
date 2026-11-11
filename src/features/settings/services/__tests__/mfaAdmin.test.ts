import { beforeEach, describe, expect, it, vi } from 'vitest';

// 組織の二要素認証の設定と、メンバーのリセット。権限の確認（authz）・セッション・DB・認証サービスの管理 API をモックする。
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireInternal: vi.fn(),
  session: null as unknown,
  organization: { requireMfaForInternal: false } as { requireMfaForInternal: boolean } | null,
  accounts: [] as { id: string; role: string; mfaFactorCount: number | null }[],
  target: null as null | { id: string; email: string; role: string },
  updates: [] as { values: unknown; filters: [string, unknown][] }[],
  targetFilters: [] as [string, unknown][],
  updateError: null as unknown,
  listFactors: vi.fn(),
  deleteFactor: vi.fn(),
  recordAuditEvent: vi.fn(async () => true),
}));

vi.mock('@/lib/authz', () => ({ requireAdmin: mocks.requireAdmin, requireInternal: mocks.requireInternal }));
vi.mock('@/lib/sessionState', () => ({ getSessionState: async () => mocks.session }));
vi.mock('@/lib/audit/events', () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('@/lib/logging/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: unknown) => {
      expect(name).toBe('list_account_access');
      expect(args).toEqual({ p_organization_id: 'org-1' });
      return { data: mocks.accounts, error: null };
    },
    from: (table: string) => {
      if (table === 'organizations') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: mocks.organization, error: null }) }) }),
          update: (values: unknown) => {
            const entry = { values, filters: [] as [string, unknown][] };
            mocks.updates.push(entry);
            return {
              eq: (column: string, value: unknown) => {
                entry.filters.push([column, value]);
                return {
                  select: () => ({
                    single: async () =>
                      mocks.updateError ? { data: null, error: mocks.updateError } : { data: values, error: null },
                  }),
                };
              },
            };
          },
        };
      }
      // profiles（リセットの対象の確認）
      const chain = {
        eq: (column: string, value: unknown) => {
          mocks.targetFilters.push([column, value]);
          return chain;
        },
        maybeSingle: async () => ({ data: mocks.target, error: null }),
      };
      return { select: () => chain };
    },
    auth: { admin: { mfa: { listFactors: mocks.listFactors, deleteFactor: mocks.deleteFactor } } },
  }),
}));

import { getMembersMfaStatus, getSecurityPolicy, resetMemberMfa, setRequireMfaForInternal } from '../mfaAdmin';

const ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEMBER_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const profile = (role: string) => ({ id: ADMIN_ID, organizationId: 'org-1', email: 'admin@example.com', fullName: null, role, stakeholderId: null });
const allow = (role = 'admin') => ({ ok: true, profile: profile(role) });
const deny = (status: 401 | 403, error: string) => ({ ok: false, status, error });
const sessionWith = (factors: unknown[]) => ({ user: { id: ADMIN_ID, email: 'admin@example.com', aal: 'aal2', factors }, profile: profile('admin'), mfa: 'ok', requireMfaForInternal: false });
const verified = { id: 'f1', status: 'verified', factor_type: 'totp' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(allow());
  mocks.requireInternal.mockResolvedValue(allow());
  mocks.session = sessionWith([verified]);
  mocks.organization = { requireMfaForInternal: false };
  mocks.accounts = [
    { id: ADMIN_ID, role: 'admin', mfaFactorCount: 1 },
    { id: MEMBER_ID, role: 'logger', mfaFactorCount: 0 },
    { id: 'viewer-id', role: 'viewer', mfaFactorCount: null },
    { id: 'holder-id', role: 'shareholder', mfaFactorCount: 1 },
  ];
  mocks.target = { id: MEMBER_ID, email: 'member@example.com', role: 'logger' };
  mocks.updates = [];
  mocks.targetFilters = [];
  mocks.updateError = null;
  mocks.listFactors.mockResolvedValue({ data: { factors: [{ id: 'f-a', status: 'verified' }, { id: 'f-b', status: 'unverified' }] }, error: null });
  mocks.deleteFactor.mockResolvedValue({ data: {}, error: null });
});

describe('getSecurityPolicy', () => {
  it('管理者には、設定・自分の登録の有無・社内の登録済みの人数を返す（株主ロールは数えない）', async () => {
    await expect(getSecurityPolicy()).resolves.toEqual({
      ok: true,
      data: { requireMfaForInternal: false, canEdit: true, viewerHasMfa: true, internalMfaCount: { enrolled: 1, total: 3 } },
    });
  });

  it('管理者以外の社内メンバーは読めるが、変えられない。人数は返さない', async () => {
    mocks.requireInternal.mockResolvedValue(allow('viewer'));
    mocks.session = sessionWith([]);
    mocks.organization = { requireMfaForInternal: true };
    await expect(getSecurityPolicy()).resolves.toEqual({
      ok: true,
      data: { requireMfaForInternal: true, canEdit: false, viewerHasMfa: false, internalMfaCount: null },
    });
  });

  it('社内のメンバーでなければ読めない', async () => {
    mocks.requireInternal.mockResolvedValue(deny(403, 'この操作を行う権限がありません'));
    await expect(getSecurityPolicy()).resolves.toEqual({ ok: false, error: 'この操作を行う権限がありません' });
  });
});

describe('setRequireMfaForInternal', () => {
  it('管理者でなければ変えられない', async () => {
    mocks.requireAdmin.mockResolvedValue(deny(403, '管理者のみ操作できます'));
    await expect(setRequireMfaForInternal(true)).resolves.toEqual({ ok: false, error: '管理者のみ操作できます' });
    expect(mocks.updates).toEqual([]);
  });

  it('自分の二要素認証を登録済みの管理者は、必須にできる（自組織の行だけを service_role で更新する）', async () => {
    await expect(setRequireMfaForInternal(true)).resolves.toEqual({ ok: true, data: { requireMfaForInternal: true } });
    expect(mocks.updates).toEqual([{ values: { requireMfaForInternal: true }, filters: [['id', 'org-1']] }]);
    // 変更の記録は organizations の行のトリガーが残すので、ここでは残さない
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('自分が未登録の管理者は、必須にできない（先に登録を求める）', async () => {
    mocks.session = sessionWith([{ id: 'f0', status: 'unverified', factor_type: 'totp' }]);
    const result = await setRequireMfaForInternal(true);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('先に、ご自身の二要素認証を登録してください') });
    expect(mocks.updates).toEqual([]);
  });

  it('必須をやめるのは、未登録の管理者でもできる', async () => {
    mocks.session = sessionWith([]);
    await expect(setRequireMfaForInternal(false)).resolves.toEqual({ ok: true, data: { requireMfaForInternal: false } });
  });

  it('真偽値でない値は弾く', async () => {
    const result = await setRequireMfaForInternal('true' as unknown as boolean);
    expect(result.ok).toBe(false);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it('保存に失敗したらエラーを返す', async () => {
    mocks.updateError = { message: 'boom' };
    await expect(setRequireMfaForInternal(true)).resolves.toEqual({ ok: false, error: '設定の保存に失敗しました' });
  });
});

describe('getMembersMfaStatus', () => {
  it('管理者に、メンバーごとの登録の有無を返す', async () => {
    await expect(getMembersMfaStatus()).resolves.toEqual({
      ok: true,
      data: { [ADMIN_ID]: true, [MEMBER_ID]: false, 'viewer-id': false, 'holder-id': true },
    });
  });

  it('管理者でなければ読めない', async () => {
    mocks.requireAdmin.mockResolvedValue(deny(401, 'セッションが確認できません。ログインし直してください'));
    expect((await getMembersMfaStatus()).ok).toBe(false);
  });
});

describe('resetMemberMfa', () => {
  it('自組織のメンバーの要素をすべて消し、auth.mfa.reset を残す（対象 = そのメンバー）', async () => {
    await expect(resetMemberMfa(MEMBER_ID)).resolves.toEqual({ ok: true, data: { removed: 2 } });

    expect(mocks.targetFilters).toEqual([['id', MEMBER_ID], ['organizationId', 'org-1']]);
    expect(mocks.listFactors).toHaveBeenCalledWith({ userId: MEMBER_ID });
    expect(mocks.deleteFactor.mock.calls.map(([args]) => args)).toEqual([
      { id: 'f-a', userId: MEMBER_ID },
      { id: 'f-b', userId: MEMBER_ID },
    ]);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: ADMIN_ID },
      {
        action: 'auth.mfa.reset',
        entityName: 'auth.users',
        entityId: MEMBER_ID,
        detail: { targetEmail: 'member@example.com', targetRole: 'logger', removedFactors: 2, removedVerifiedFactors: 1 },
      },
      expect.anything(),
    );
  });

  it('管理者でなければできない', async () => {
    mocks.requireAdmin.mockResolvedValue(deny(403, '管理者のみ操作できます'));
    await expect(resetMemberMfa(MEMBER_ID)).resolves.toEqual({ ok: false, error: '管理者のみ操作できます' });
    expect(mocks.deleteFactor).not.toHaveBeenCalled();
  });

  it('自分のリセットはできない', async () => {
    const result = await resetMemberMfa(ADMIN_ID);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('アカウント設定から解除') });
    expect(mocks.listFactors).not.toHaveBeenCalled();
  });

  it('ほかの組織のアカウント・存在しない id・形の違う id は対象にしない', async () => {
    mocks.target = null;
    await expect(resetMemberMfa(MEMBER_ID)).resolves.toEqual({ ok: false, error: '対象のメンバーが見つかりません' });
    await expect(resetMemberMfa('not-a-uuid')).resolves.toEqual({ ok: false, error: '対象のメンバーが見つかりません' });
    await expect(resetMemberMfa(undefined as unknown as string)).resolves.toEqual({ ok: false, error: '対象のメンバーが見つかりません' });
    expect(mocks.listFactors).not.toHaveBeenCalled();
  });

  it('一部を消せなかったときは、消した分を失敗つきで残し、エラーを返す', async () => {
    mocks.deleteFactor.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const result = await resetMemberMfa(MEMBER_ID);
    expect(result.ok).toBe(false);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'auth.mfa.reset',
        outcome: 'failure',
        detail: expect.objectContaining({ removedFactors: 1, failedFactors: 1 }),
      }),
      expect.anything(),
    );
  });
});
