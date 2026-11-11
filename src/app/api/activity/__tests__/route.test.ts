import { beforeEach, describe, expect, it, vi } from 'vitest';

// Excel への出力・印刷の記録（POST /api/activity）。社内の人だけが、決まった種類の操作だけを残せることを確かめる。

const mocks = vi.hoisted(() => ({
  requireInternal: vi.fn(),
  recordAuditEvent: vi.fn(async () => true),
}));

vi.mock('@/lib/authz', () => ({ requireInternal: mocks.requireInternal }));
vi.mock('@/lib/audit/events', () => ({ recordAuditEvent: mocks.recordAuditEvent }));

import { POST } from '../route';

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/activity', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

const member = { id: 'user-1', organizationId: 'org-1', email: 'm@example.com', fullName: null, role: 'logger', stakeholderId: null };

describe('POST /api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireInternal.mockResolvedValue({ ok: true, profile: member });
    mocks.recordAuditEvent.mockResolvedValue(true);
  });

  it('出力を、本人の操作として監査ログに残す（内容は決まった形だけ）', async () => {
    const response = await post({ kind: 'export.shareholder_registry', detail: { asOf: '2026-11-11', rows: 5, fileName: '株主名簿.xlsx', extra: 'x' } });
    expect(response.status).toBe(201);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: 'user-1' },
      { action: 'export.shareholder_registry', entityName: 'export', entityId: null, detail: { asOf: '2026-11-11', rows: 5, fileName: '株主名簿.xlsx' } },
    );
  });

  it('決まっていない種類・壊れた本文は 400 で、何も残さない', async () => {
    expect((await post({ kind: 'auth.login' })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('社内の人でなければ断り、何も残さない', async () => {
    mocks.requireInternal.mockResolvedValue({ ok: false, status: 403, error: 'この操作を行う権限がありません' });
    expect((await post({ kind: 'export.cap_table' })).status).toBe(403);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('記録に失敗したら 500（ブラウザは出力をやめる）', async () => {
    mocks.recordAuditEvent.mockResolvedValue(false);
    expect((await post({ kind: 'export.cap_table' })).status).toBe(500);
  });
});
