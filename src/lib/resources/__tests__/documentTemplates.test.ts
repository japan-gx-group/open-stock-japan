// 文書テンプレートの保存の決まり（src/lib/resources/server.ts の applyHooks）。
// 「確認済み」は、いまの文面を人が確かめたという印なので、文面が変わったら「確認中」に戻す。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/logging/logger', () => ({ logger: { error: vi.fn() } }));

import { updateResource } from '../server';

const ORG = 'org-1';
const ID = '00000000-0000-4000-8000-000000000001';
const actor = { id: 'user-1', organizationId: ORG };

/** document_templates の 1 行だけを持つ、最小の DB の代わり */
const fakeAdmin = (existing: Record<string, unknown>) => {
  const state = { updated: null as Record<string, unknown> | null, audits: [] as Record<string, unknown>[] };
  const admin = {
    from: (table: string) => {
      if (table === 'system_audit_logs') {
        return { insert: async (row: Record<string, unknown>) => (state.audits.push(row), { error: null }) };
      }
      const read = { eq: () => read, maybeSingle: async () => ({ data: existing }) };
      const written = { eq: () => written, select: () => ({ single: async () => ({ data: { ...existing, ...state.updated }, error: null }) }) };
      return {
        select: () => read,
        update: (values: Record<string, unknown>) => {
          state.updated = values;
          return written;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, state };
};

const reviewed = { id: ID, title: '招集通知', kind: 'shareholder_notice', status: 'reviewed', body: '株主各位\n{{会社名}}', notes: '' };

describe('文書テンプレートの更新', () => {
  beforeEach(() => vi.clearAllMocks());

  it('確認済みのテンプレートの文面を変えると、「確認済み」と送られていても「確認中」に戻す', async () => {
    const { admin, state } = fakeAdmin(reviewed);
    const result = await updateResource('document-templates', actor, ID, { ...reviewed, body: '株主各位\n{{会社名}}\n追記' }, admin);
    expect(result.ok).toBe(true);
    expect(state.updated).toMatchObject({ status: 'draft', body: '株主各位\n{{会社名}}\n追記' });
  });

  it('文面が同じなら、名前やメモを変えても「確認済み」のまま', async () => {
    const { admin, state } = fakeAdmin(reviewed);
    await updateResource('document-templates', actor, ID, { ...reviewed, title: '臨時株主総会の招集通知', notes: '顧問弁護士の確認済み' }, admin);
    expect(state.updated).toMatchObject({ status: 'reviewed', title: '臨時株主総会の招集通知' });
  });

  it('確認中のテンプレートは、文面と一緒に「確認済み」にできる', async () => {
    const { admin, state } = fakeAdmin({ ...reviewed, status: 'draft' });
    await updateResource('document-templates', actor, ID, { ...reviewed, status: 'reviewed', body: '直した文面' }, admin);
    expect(state.updated).toMatchObject({ status: 'reviewed', body: '直した文面' });
  });

  it('種類・状態が一覧に無い値なら保存しない', async () => {
    const { admin, state } = fakeAdmin(reviewed);
    const badKind = await updateResource('document-templates', actor, ID, { ...reviewed, kind: 'love_letter' }, admin);
    expect(badKind).toMatchObject({ ok: false, status: 400 });
    const badStatus = await updateResource('document-templates', actor, ID, { ...reviewed, status: 'approved' }, admin);
    expect(badStatus).toMatchObject({ ok: false, status: 400 });
    expect(state.updated).toBeNull();
  });

  it('文面が上限（80,000 字）を超えたら保存しない', async () => {
    const { admin, state } = fakeAdmin(reviewed);
    const result = await updateResource('document-templates', actor, ID, { ...reviewed, body: 'あ'.repeat(80_001) }, admin);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(state.updated).toBeNull();
  });

  it('監査ログには、名前と変えた項目だけを残す（文面は残さない）', async () => {
    const { admin, state } = fakeAdmin(reviewed);
    await updateResource('document-templates', actor, ID, { ...reviewed, body: '秘密の文面' }, admin);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ action: 'document-templates.update', entityName: 'document_templates', entityId: ID });
    expect(String(state.audits[0].detail)).not.toContain('秘密の文面');
  });
});
