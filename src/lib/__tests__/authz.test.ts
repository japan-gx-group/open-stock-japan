import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  recordAuditEvent: vi.fn(async () => true),
  route: 'POST /api/company' as string | null,
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

// 権限エラーは監査ログに残す（DB には触れず、呼び出しだけを確かめる）
vi.mock('@/lib/audit/events', () => ({
  recordAuditEvent: mocks.recordAuditEvent,
}));

vi.mock('@/lib/audit/requestContext', () => ({
  readAuditRequestContext: async () => ({ actorId: null, ip: null, userAgent: null, requestId: null, route: mocks.route }),
}));

import {
  ADMIN_ONLY_MESSAGE,
  EDITOR_ONLY_MESSAGE,
  INTERNAL_ONLY_MESSAGE,
  SIGNED_OUT_MESSAGE,
  requireAdmin,
  requireEditor,
  requireInternal,
} from '../authz';

const profile = (role: 'admin' | 'logger' | 'viewer' | 'shareholder') => ({
  id: 'user-1',
  organizationId: 'org-1',
  email: 'user@example.com',
  fullName: null,
  role,
  stakeholderId: role === 'shareholder' ? 'stakeholder-1' : null,
});

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('管理者なら通し、プロフィールを返す', async () => {
    mocks.getCurrentProfile.mockResolvedValue(profile('admin'));
    await expect(requireAdmin()).resolves.toEqual({ ok: true, profile: profile('admin') });
  });

  it('管理者以外（logger・viewer・shareholder）は 403', async () => {
    for (const role of ['logger', 'viewer', 'shareholder'] as const) {
      mocks.getCurrentProfile.mockResolvedValue(profile(role));
      await expect(requireAdmin()).resolves.toEqual({
        ok: false,
        status: 403,
        error: ADMIN_ONLY_MESSAGE,
      });
    }
  });

  it('ログインしていなければ 401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    await expect(requireAdmin()).resolves.toEqual({
      ok: false,
      status: 401,
      error: SIGNED_OUT_MESSAGE,
    });
  });
});

describe('requireEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('管理者とメンバーは通す', async () => {
    for (const role of ['admin', 'logger'] as const) {
      mocks.getCurrentProfile.mockResolvedValue(profile(role));
      await expect(requireEditor()).resolves.toEqual({ ok: true, profile: profile(role) });
    }
  });

  it('閲覧のみ・株主は 403', async () => {
    for (const role of ['viewer', 'shareholder'] as const) {
      mocks.getCurrentProfile.mockResolvedValue(profile(role));
      await expect(requireEditor()).resolves.toEqual({
        ok: false,
        status: 403,
        error: EDITOR_ONLY_MESSAGE,
      });
    }
  });

  it('ログインしていなければ 401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    await expect(requireEditor()).resolves.toEqual({
      ok: false,
      status: 401,
      error: SIGNED_OUT_MESSAGE,
    });
  });
});

describe('requireInternal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('社内の全員（admin・logger・viewer）を通す', async () => {
    for (const role of ['admin', 'logger', 'viewer'] as const) {
      mocks.getCurrentProfile.mockResolvedValue(profile(role));
      await expect(requireInternal()).resolves.toEqual({ ok: true, profile: profile(role) });
    }
  });

  it('株主は 403', async () => {
    mocks.getCurrentProfile.mockResolvedValue(profile('shareholder'));
    await expect(requireInternal()).resolves.toEqual({
      ok: false,
      status: 403,
      error: INTERNAL_ONLY_MESSAGE,
    });
  });

  it('ログインしていなければ 401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    await expect(requireInternal()).resolves.toEqual({
      ok: false,
      status: 401,
      error: SIGNED_OUT_MESSAGE,
    });
  });
});

describe('権限エラーの記録', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('権限の無い操作を試みたことを、足りなかった権限・ロール・操作つきで監査ログに残す', async () => {
    mocks.route = 'DELETE /api/resources/stakeholders/denied-record-1';
    mocks.getCurrentProfile.mockResolvedValue({ ...profile('viewer'), id: 'denied-user-1' });
    await requireEditor();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: 'denied-user-1' },
      {
        action: 'access.denied',
        entityName: 'access',
        detail: { required: 'editor', role: 'viewer', route: 'DELETE /api/resources/stakeholders/denied-record-1' },
        outcome: 'denied',
      },
    );
  });

  it('同じ人の同じ操作は、続けて試みても 1 件だけ残す（監査ログを埋めない）', async () => {
    mocks.route = 'GET /api/denied-repeat';
    mocks.getCurrentProfile.mockResolvedValue({ ...profile('shareholder'), id: 'denied-user-2' });
    await requireInternal();
    await requireInternal();
    await requireInternal();
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('権限がある操作と、ログインしていない場合は残さない', async () => {
    mocks.getCurrentProfile.mockResolvedValue(profile('admin'));
    await requireAdmin();
    mocks.getCurrentProfile.mockResolvedValue(null);
    await requireAdmin();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});
