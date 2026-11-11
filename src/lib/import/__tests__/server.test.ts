// 反映（applyExtraction）の段取りを、DB と台帳の書き込みを差し替えて確かめる。
// 守りたいこと: 検証を通らなければ何も書かない / 2 回反映しない / 途中で失敗したら作った行を逆順に消して状態を戻す。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApplyPayload } from '../applyPlan';
import { buildReviewState } from '../review';
import type { ImportExtraction, ReviewState } from '../types';
import { context, ID, investmentExtraction } from './fixture';

interface Call {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: unknown;
  filters: Record<string, unknown>;
}

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  extraction: null as Record<string, unknown> | null,
  claimed: [{ id: 'x' }] as { id: string }[],
  company: {} as Record<string, unknown>,
  lists: {} as Record<string, Record<string, unknown>[]>,
}));

const resources = vi.hoisted(() => ({
  createResource: vi.fn(),
  deleteResource: vi.fn(),
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: {} };
      const run = () => {
        db.calls.push(call);
        if (table === 'document_extractions') {
          if (call.op === 'select') return { data: db.extraction, error: null };
          const payload = call.payload as { status?: string };
          return { data: payload.status === 'applied' ? db.claimed : [{ id: 'x' }], error: null };
        }
        if (table === 'documents') return { data: { id: 'doc-1', title: 'テスト契約', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1, category: 'other', entityId: null }, error: null };
        if (table === 'organizations') return { data: call.op === 'select' ? db.company : { id: 'org-1' }, error: null };
        if (table === 'share_transactions') return { data: [{ id: 'transfer-out' }, { id: 'transfer-in' }], error: null };
        return { data: [], error: null };
      };
      const builder = {
        select: () => builder,
        insert: (payload: unknown) => Object.assign(call, { op: 'insert', payload }) && builder,
        update: (payload: unknown) => Object.assign(call, { op: 'update', payload }) && builder,
        eq: (key: string, value: unknown) => {
          call.filters[key] = value;
          return builder;
        },
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => run(),
        single: async () => run(),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/resources/server', () => ({
  ...resources,
  listResource: vi.fn(async (name: string) => db.lists[name] ?? []),
}));
vi.mock('@/lib/documents/server', () => ({ DOCUMENT_COLUMNS: 'id', readDocumentFile: vi.fn(), uploadDocument: vi.fn() }));
vi.mock('@/lib/ai/generate', () => ({ generateStructured: vi.fn() }));

import { applyExtraction, discardExtraction } from '../server';

const EXTRACTION_ID = '70000000-0000-4000-8000-000000000001';
const admin = { id: 'user-1', organizationId: 'org-1', role: 'admin' as const };
const member = { ...admin, role: 'logger' as const };

const setExtraction = (result: ImportExtraction, status = 'extracted') => {
  db.extraction = { id: EXTRACTION_ID, documentId: 'doc-1', documentKind: result.documentKind, status, provider: 'google', modelId: 'm', result, appliedSummary: null, createdByUserId: 'user-1', appliedByUserId: null, appliedAt: null, createdAt: '2026-11-11T00:00:00Z' };
};

const payloadOf = (result: ImportExtraction, edit: (state: ReviewState) => void = () => undefined) => {
  const state = buildReviewState(result, context());
  edit(state);
  return JSON.parse(JSON.stringify(toApplyPayload(state)));
};

const updatesOf = (table: string) => db.calls.filter((call) => call.table === table && call.op === 'update').map((call) => call.payload as Record<string, unknown>);

let created: { name: string; body: Record<string, unknown>; id: string }[] = [];

beforeEach(() => {
  db.calls = [];
  db.claimed = [{ id: 'x' }];
  const base = context();
  db.company = { id: 'org-1', ...base.company };
  db.lists = {
    stakeholders: base.stakeholders.map((row) => ({ id: row.id, name: row.label })),
    'share-classes': base.shareClasses.map((row) => ({ id: row.id, name: row.label })),
    'funding-rounds': base.fundingRounds.map((row) => ({ id: row.id, name: row.label })),
    'share-transactions': base.shareTransactions,
    officers: base.officers,
  };
  created = [];
  resources.createResource.mockReset();
  resources.deleteResource.mockReset();
  resources.recordAudit.mockClear();
  resources.createResource.mockImplementation(async (name: string, _actor: unknown, body: Record<string, unknown>) => {
    const id = `new-${created.length + 1}`;
    created.push({ name, body, id });
    return { ok: true, data: { id, ...body } };
  });
  resources.deleteResource.mockImplementation(async () => ({ ok: true, data: { deletedIds: [] } }));
  setExtraction(investmentExtraction());
});

describe('applyExtraction', () => {
  it('参照される側から順に作り、新しく作った行の id を後の行の参照に入れる', async () => {
    const result = await applyExtraction(admin, EXTRACTION_ID, payloadOf(investmentExtraction()));
    expect(result.ok).toBe(true);
    expect(created.map((item) => item.name)).toEqual(['stakeholders', 'stakeholders', 'share-classes', 'funding-rounds', 'share-transactions', 'share-transactions', 'share-transactions']);
    const [corp, , shareClass, round, first, second] = created;
    expect(round.body.shareClassId).toBe(shareClass.id);
    // 登録済みの株主はその id、新しく作った株主は作った id
    expect(first.body).toMatchObject({ stakeholderId: ID.fund, shareClassId: shareClass.id, roundId: round.id, shares: '1,500', transactionType: 'new_issue' });
    expect(second.body.stakeholderId).toBe(corp.id);
    // どの文書から取り込んだかをメモに残す
    expect(first.body.notes).toBe('AI 取り込み（文書: テスト契約）');
    // 状態を applied にしてから書き、記録（appliedSummary）と文書への関連づけを残す
    const updates = updatesOf('document_extractions');
    expect(updates[0]).toMatchObject({ status: 'applied', appliedByUserId: 'user-1' });
    const summary = updates.find((payload) => 'appliedSummary' in payload)?.appliedSummary as { created: { group: string; items: unknown[] }[]; documentLink: unknown };
    expect(summary.created.map((entry) => [entry.group, entry.items.length])).toEqual([['stakeholders', 2], ['shareClasses', 1], ['fundingRound', 1], ['shareTransactions', 3]]);
    expect(summary.documentLink).toEqual({ entityType: 'funding_round', entityId: round.id });
    expect(updatesOf('documents')).toEqual([{ entityType: 'funding_round', entityId: round.id }]);
    expect(resources.recordAudit.mock.calls.some((call) => (call as unknown[])[2] === 'import.apply')).toBe(true);
    expect(resources.deleteResource).not.toHaveBeenCalled();
  });

  it('すべての書き込みを、自分の組織で絞る', async () => {
    await applyExtraction(admin, EXTRACTION_ID, payloadOf(investmentExtraction()));
    for (const call of db.calls.filter((item) => item.table === 'document_extractions' || item.table === 'documents')) {
      expect(call.filters.organizationId, `${call.table}.${call.op}`).toBe('org-1');
    }
    expect(resources.createResource.mock.calls.every((call) => (call[1] as { organizationId: string }).organizationId === 'org-1')).toBe(true);
  });

  it('途中で失敗したら、作った行を逆順に消し、状態を「確認待ち」に戻す', async () => {
    resources.createResource.mockImplementation(async (name: string, _actor: unknown, body: Record<string, unknown>) => {
      if (name === 'share-transactions' && created.filter((item) => item.name === name).length === 1) return { ok: false, status: 400, error: '株式の異動の保存に失敗しました' };
      const id = `new-${created.length + 1}`;
      created.push({ name, body, id });
      return { ok: true, data: { id, ...body } };
    });
    const result = await applyExtraction(admin, EXTRACTION_ID, payloadOf(investmentExtraction()));
    expect(result).toMatchObject({ ok: false, status: 400, code: 'apply_failed' });
    expect(!result.ok && result.error).toContain('株式の異動の保存に失敗しました');
    expect(!result.ok && result.error).toContain('反映の前の状態に戻しました');
    // 作った 5 行（株主 2・種類・ラウンド・異動 1）を、作った順の逆に消す
    expect(resources.deleteResource.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ['share-transactions', 'new-5'],
      ['funding-rounds', 'new-4'],
      ['share-classes', 'new-3'],
      ['stakeholders', 'new-2'],
      ['stakeholders', 'new-1'],
    ]);
    const updates = updatesOf('document_extractions');
    expect(updates[updates.length - 1]).toEqual({ status: 'extracted', appliedByUserId: null, appliedAt: null });
    expect(updates.some((payload) => 'appliedSummary' in payload)).toBe(false);
    expect(updatesOf('documents')).toEqual([]);
  });

  it('書き込みが例外を投げても、同じように取り消す', async () => {
    resources.createResource.mockImplementation(async (name: string, _actor: unknown, body: Record<string, unknown>) => {
      if (name === 'funding-rounds') throw new Error('connection reset');
      const id = `new-${created.length + 1}`;
      created.push({ name, body, id });
      return { ok: true, data: { id, ...body } };
    });
    const result = await applyExtraction(admin, EXTRACTION_ID, payloadOf(investmentExtraction()));
    expect(result.ok).toBe(false);
    expect(resources.deleteResource).toHaveBeenCalledTimes(3);
    expect(updatesOf('document_extractions').at(-1)).toMatchObject({ status: 'extracted' });
  });

  it('取り消しにも失敗した行は、そのまま伝える', async () => {
    resources.createResource.mockImplementation(async (name: string, _actor: unknown, body: Record<string, unknown>) => {
      if (name === 'share-transactions') return { ok: false, status: 400, error: '保存に失敗しました' };
      const id = `new-${created.length + 1}`;
      created.push({ name, body, id });
      return { ok: true, data: { id, ...body } };
    });
    resources.deleteResource.mockImplementation(async (name: string) => (name === 'share-classes' ? { ok: false, status: 409, error: '参照されています' } : { ok: true, data: { deletedIds: [] } }));
    const result = await applyExtraction(admin, EXTRACTION_ID, payloadOf(investmentExtraction()));
    expect(result).toMatchObject({ ok: false, status: 500, code: 'rollback_failed' });
    expect(!result.ok && result.error).toContain('株式の種類「B種優先株式」');
    // 消せなかった行があっても、残りの取り消しは続ける
    expect(resources.deleteResource).toHaveBeenCalledTimes(4);
  });

  it('反映済み・破棄済みの結果は反映しない（何も書かない）', async () => {
    for (const status of ['applied', 'discarded']) {
      setExtraction(investmentExtraction(), status);
      const result = await applyExtraction(admin, EXTRACTION_ID, payloadOf(investmentExtraction()));
      expect(result).toMatchObject({ ok: false, status: 409 });
    }
    expect(resources.createResource).not.toHaveBeenCalled();
    expect(updatesOf('document_extractions')).toEqual([]);
  });

  it('同時に 2 回押されても、状態を変えられた 1 回だけが書く', async () => {
    db.claimed = [];
    const result = await applyExtraction(admin, EXTRACTION_ID, payloadOf(investmentExtraction()));
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(resources.createResource).not.toHaveBeenCalled();
  });

  it('検証を通らない行があれば、状態を変えずに断る（行ごとの問題を返す）', async () => {
    const body = payloadOf(investmentExtraction(), (state) => {
      (state.shareTransactions ?? [])[0].values.shares = '0';
    });
    const result = await applyExtraction(admin, EXTRACTION_ID, body);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(!result.ok && result.rowIssues?.['shareTransactions-0'].fieldErrors.shares).toBeTruthy();
    expect(resources.createResource).not.toHaveBeenCalled();
    expect(updatesOf('document_extractions')).toEqual([]);
  });

  it('形の違う本文・見つからない id は断る', async () => {
    expect(await applyExtraction(admin, EXTRACTION_ID, { rows: 'x' })).toMatchObject({ ok: false, status: 400 });
    expect(await applyExtraction(admin, 'not-a-uuid', {})).toMatchObject({ ok: false, status: 404 });
    db.extraction = null;
    expect(await applyExtraction(admin, EXTRACTION_ID, {})).toMatchObject({ ok: false, status: 404 });
    expect(resources.createResource).not.toHaveBeenCalled();
  });

  it('画面が送った「登録済み」の id は、今の台帳に無ければ通さない', async () => {
    const body = payloadOf(investmentExtraction());
    db.lists.stakeholders = db.lists.stakeholders.filter((row) => row.id !== ID.fund);
    const result = await applyExtraction(admin, EXTRACTION_ID, body);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(!result.ok && result.error).toContain('株主が見つかりません');
    expect(resources.createResource).not.toHaveBeenCalled();
  });
});

describe('applyExtraction（会社情報・株式譲渡）', () => {
  const registry = (): ImportExtraction => ({
    documentKind: 'registry',
    summary: '',
    documentDate: null,
    warnings: [],
    groups: { company: [{ name: '架空テック株式会社', address: '東京都港区架空九丁目9番9号', capitalAmount: 126_000_000 }], officers: [{ name: '架空 新任', position: 'director' }] },
  });

  it('会社情報は、選んだ項目だけを更新する（役員を作ったあと、最後に）', async () => {
    setExtraction(registry());
    const body = payloadOf(registry(), (state) => {
      (state.company ?? [])[0].ticked = ['capitalAmount'];
    });
    const result = await applyExtraction(admin, EXTRACTION_ID, body);
    expect(result.ok).toBe(true);
    expect(updatesOf('organizations')).toEqual([{ capitalAmount: 126_000_000 }]);
    expect(created.map((item) => item.name)).toEqual(['officers']);
    const summary = updatesOf('document_extractions').find((payload) => 'appliedSummary' in payload)?.appliedSummary as { companyFields: unknown[] };
    expect(summary.companyFields).toEqual([{ key: 'capitalAmount', label: '資本金の額' }]);
  });

  it('管理者でない人は、会社情報を含む反映ができない（何も書かない）', async () => {
    setExtraction(registry());
    const result = await applyExtraction(member, EXTRACTION_ID, payloadOf(registry()));
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(!result.ok && result.error).toContain('管理者だけ');
    expect(updatesOf('organizations')).toEqual([]);
    expect(resources.createResource).not.toHaveBeenCalled();
  });

  it('管理者でない人も、会社情報を外せば役員などは反映できる', async () => {
    setExtraction(registry());
    const body = payloadOf(registry(), (state) => {
      (state.company ?? [])[0].include = false;
    });
    const result = await applyExtraction(member, EXTRACTION_ID, body);
    expect(result.ok).toBe(true);
    expect(updatesOf('organizations')).toEqual([]);
    expect(created.map((item) => item.name)).toEqual(['officers']);
  });

  it('株式譲渡は、譲渡人の減少と譲受人の増加の 2 行を同じ groupId で作る', async () => {
    const transfer: ImportExtraction = {
      documentKind: 'share_transfer',
      summary: '',
      documentDate: null,
      warnings: [],
      groups: {
        stakeholders: [{ name: '架空 譲受' }],
        transfers: [{ fromName: '創業 太郎', toName: '架空 譲受', shareClassName: '普通株式', transactionDate: '2026-11-01', shares: 1000, pricePerShare: 500 }],
      },
    };
    setExtraction(transfer);
    const result = await applyExtraction(admin, EXTRACTION_ID, payloadOf(transfer));
    expect(result.ok).toBe(true);
    const insert = db.calls.find((call) => call.table === 'share_transactions' && call.op === 'insert')?.payload as Record<string, unknown>[];
    expect(insert).toHaveLength(2);
    expect(insert[0]).toMatchObject({ organizationId: 'org-1', stakeholderId: ID.founder, shares: -1000, transactionType: 'transfer', shareClassId: ID.common, amount: 500_000, counterparty: '架空 譲受', transactionDate: '2026-11-01' });
    expect(insert[1]).toMatchObject({ stakeholderId: 'new-1', shares: 1000, counterparty: '創業 太郎' });
    expect(insert[0].groupId).toBe(insert[1].groupId);
    expect(typeof insert[0].groupId).toBe('string');
  });
});

describe('discardExtraction', () => {
  it('確認待ちの結果だけを破棄にする', async () => {
    expect(await discardExtraction(admin, EXTRACTION_ID)).toEqual({ ok: true, data: { id: EXTRACTION_ID } });
    const call = db.calls.find((item) => item.table === 'document_extractions' && item.op === 'update');
    expect(call?.payload).toEqual({ status: 'discarded' });
    expect(call?.filters).toMatchObject({ organizationId: 'org-1', id: EXTRACTION_ID, status: 'extracted' });
    expect(await discardExtraction(admin, 'x')).toMatchObject({ ok: false, status: 404 });
  });
});
