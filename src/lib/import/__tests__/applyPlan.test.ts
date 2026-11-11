import { describe, expect, it } from 'vitest';
import { parseApplyPayload, planApply, toApplyPayload } from '../applyPlan';
import { buildReviewState, checkReview, refExisting, refNew } from '../review';
import type { ImportExtraction } from '../types';
import { context, ID, investmentExtraction } from './fixture';

const state = () => buildReviewState(investmentExtraction(), context());

describe('parseApplyPayload', () => {
  it('画面の状態を送って受け取ると、値・参照・対象はそのまま、表示用の情報は落ちる', () => {
    const original = state();
    const parsed = parseApplyPayload('investment_agreement', JSON.parse(JSON.stringify(toApplyPayload(original))));
    expect(parsed?.shareTransactions?.[1]).toMatchObject({
      key: 'shareTransactions-1',
      include: true,
      values: original.shareTransactions?.[1].values,
      refs: original.shareTransactions?.[1].refs,
      names: {},
      existing: null,
      similar: [],
    });
    expect(parsed?.stakeholders?.[0].include).toBe(false);
    // 受け取った状態でも、同じ検証を通る
    expect(checkReview('investment_agreement', parsed ?? {}, context()).errorCount).toBe(0);
  });

  it('形が使えない本文は null', () => {
    expect(parseApplyPayload('investment_agreement', null)).toBeNull();
    expect(parseApplyPayload('investment_agreement', { rows: [] })).toBeNull();
    expect(parseApplyPayload('investment_agreement', { rows: { stakeholders: 'x' } })).toBeNull();
    expect(parseApplyPayload('investment_agreement', { rows: { stakeholders: [{ key: 'officers-0' }] } })).toBeNull();
    expect(parseApplyPayload('investment_agreement', { rows: { stakeholders: [{ key: 'stakeholders-0' }, { key: 'stakeholders-0' }] } })).toBeNull();
    expect(parseApplyPayload('investment_agreement', { rows: { fundingRound: [{ key: 'fundingRound-0' }, { key: 'fundingRound-1' }] } })).toBeNull();
    expect(parseApplyPayload('investment_agreement', { rows: { stakeholders: Array.from({ length: 500 }, (_, index) => ({ key: `stakeholders-${index}` })) } })).toBeNull();
  });

  it('文書の種類に無いまとまり・画面に無い項目・知らない参照は受け取らない', () => {
    const parsed = parseApplyPayload('investment_agreement', {
      rows: {
        company: [{ key: 'company-0', include: true, values: { name: '乗っ取り株式会社' }, ticked: ['name'] }],
        stakeholders: [
          { key: 'stakeholders-0', include: 'yes', values: { name: '架空 太郎', email: 'x@example.com', organizationId: 'x', kind: 5 }, refs: { stakeholderId: refExisting(ID.fund) } },
        ],
      },
    });
    expect(parsed && 'company' in parsed).toBe(false);
    const row = parsed?.stakeholders?.[0];
    // include は true のときだけ対象（'yes' などは対象にしない）
    expect(row?.include).toBe(false);
    expect(row?.values).toMatchObject({ name: '架空 太郎', kind: '5' });
    expect(row && 'email' in row.values).toBe(false);
    expect(row && 'organizationId' in row.values).toBe(false);
    expect(row?.refs).toEqual({});
  });

  it('形の違う参照は、未選択にせず検証で止まる値にする', () => {
    const parsed = parseApplyPayload('investment_agreement', {
      rows: { shareTransactions: [{ key: 'shareTransactions-0', include: true, values: {}, refs: { stakeholderId: 'DROP TABLE', roundId: 12, shareClassId: refNew('shareClasses-0') } }] },
    });
    expect(parsed?.shareTransactions?.[0].refs).toEqual({ stakeholderId: 'invalid', shareClassId: refNew('shareClasses-0'), roundId: '' });
    const check = checkReview('investment_agreement', parsed ?? {}, context());
    expect(check.rows['shareTransactions-0'].fieldErrors.stakeholderId).toBeTruthy();
  });

  it('会社情報の ticked は、その文書の種類で扱う項目だけ', () => {
    const parsed = parseApplyPayload('registry', {
      rows: { company: [{ key: 'company-0', include: true, values: { capitalAmount: 1000 }, ticked: ['capitalAmount', 'capitalAmount', 'fiscalYearStartMonth', 7] }] },
    });
    expect(parsed?.company?.[0].ticked).toEqual(['capitalAmount']);
    expect(parsed?.company?.[0].values.capitalAmount).toBe('1000');
  });
});

describe('planApply', () => {
  it('参照される側が先になる順に並べる（株主 → 種類 → ラウンド → 異動）', () => {
    const plan = planApply('investment_agreement', state());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.steps.map((step) => step.row.key)).toEqual([
      'stakeholders-1',
      'stakeholders-2',
      'shareClasses-0',
      'fundingRound-0',
      'shareTransactions-0',
      'shareTransactions-1',
      'shareTransactions-2',
    ]);
    expect(plan.steps.every((step) => step.action === 'create')).toBe(true);
    expect(plan.steps[3].dependsOn).toEqual(['shareClasses-0']);
    expect(plan.steps[5].dependsOn).toEqual(['stakeholders-1', 'shareClasses-0', 'fundingRound-0']);
    // どの手順も、先に作られた行だけに依存する
    const seen = new Set<string>();
    for (const step of plan.steps) {
      expect(step.dependsOn.every((key) => seen.has(key))).toBe(true);
      seen.add(step.row.key);
    }
  });

  it('対象から外した行は手順に入らない。登録済みの行（既定で対象外）も入らない', () => {
    const current = state();
    (current.shareTransactions ?? [])[2].include = false;
    (current.stakeholders ?? [])[2].include = false;
    const plan = planApply('investment_agreement', current);
    expect(plan.ok && plan.steps.map((step) => step.row.key)).toEqual(['stakeholders-1', 'shareClasses-0', 'fundingRound-0', 'shareTransactions-0', 'shareTransactions-1']);
  });

  it('対象になっていない行を新しく作る前提で参照していると、段取りを作らない', () => {
    const current = state();
    (current.stakeholders ?? [])[1].include = false;
    const plan = planApply('investment_agreement', current);
    expect(plan).toMatchObject({ ok: false });
    expect(!plan.ok && plan.error).toContain('株主');
  });

  it('後のまとまりの行への参照（順番の逆転）は通さない', () => {
    const current = state();
    (current.fundingRound ?? [])[0].refs.shareClassId = refNew('shareTransactions-0');
    expect(planApply('investment_agreement', current).ok).toBe(false);
  });

  it('対象の行が無ければ反映しない', () => {
    const current = state();
    for (const rows of Object.values(current)) for (const row of rows ?? []) row.include = false;
    expect(planApply('investment_agreement', current)).toEqual({ ok: false, error: '反映する行がありません。対象にする行を選んでください' });
  });

  it('会社情報は最後、譲渡は株主のあと。照合だけのまとまりは手順に入らない', () => {
    const registry: ImportExtraction = {
      documentKind: 'registry',
      summary: '',
      documentDate: null,
      warnings: [],
      groups: {
        company: [{ capitalAmount: 1 }],
        officers: [{ name: '架空 新任', position: 'director' }],
        issuedShares: [{ shareClassName: '普通株式', shares: 1 }],
        shareClasses: [{ name: 'C種優先株式', kind: 'preferred' }],
      },
    };
    const built = buildReviewState(registry, context());
    (built.issuedShares ?? [])[0].include = true;
    const plan = planApply('registry', built);
    expect(plan.ok && plan.steps.map((step) => `${step.action}:${step.row.key}`)).toEqual(['create:shareClasses-0', 'create:officers-0', 'company:company-0']);

    const transfer: ImportExtraction = {
      documentKind: 'share_transfer',
      summary: '',
      documentDate: null,
      warnings: [],
      groups: {
        stakeholders: [{ name: '架空 譲受' }],
        transfers: [{ fromName: '創業 太郎', toName: '架空 譲受', shareClassName: '普通株式', transactionDate: '2026-11-01', shares: 10 }],
      },
    };
    const transferPlan = planApply('share_transfer', buildReviewState(transfer, context()));
    expect(transferPlan.ok && transferPlan.steps.map((step) => `${step.action}:${step.row.key}`)).toEqual(['create:stakeholders-0', 'transfer:transfers-0']);
  });
});
