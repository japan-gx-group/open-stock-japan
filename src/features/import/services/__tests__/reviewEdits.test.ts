import { describe, expect, it } from 'vitest';
import { buildReviewState, checkReview, refExisting, refNew } from '@/lib/import/review';
import { context, ID, investmentExtraction } from '@/lib/import/__tests__/fixture';
import { appliedLinkOf } from '../appliedLinks';
import { checkImportFile, formatFileSize } from '../importFile';
import { linkToExistingRow, setCompanyFieldTicked, setGroupIncluded, setGroupValue, setRowIncluded, setRowRef, setRowValue, summarizeApply } from '../reviewEdits';

const state = () => buildReviewState(investmentExtraction(), context());

describe('reviewEdits', () => {
  it('値・参照の書き換えは、元の状態を変えずに新しい状態を返す', () => {
    const original = state();
    const next = setRowRef(setRowValue(original, 'shareTransactions', 'shareTransactions-0', 'shares', '2,000'), 'shareTransactions', 'shareTransactions-0', 'roundId', '');
    expect(next.shareTransactions?.[0].values.shares).toBe('2,000');
    expect(next.shareTransactions?.[0].refs.roundId).toBe('');
    expect(original.shareTransactions?.[0].values.shares).toBe('1,500');
    expect(next.shareTransactions?.[1]).toBe(original.shareTransactions?.[1]);
  });

  it('似た名前の登録済みの行と「同じ」にすると、その行は作らず、参照を登録済みに付け替える', () => {
    const next = linkToExistingRow(state(), 'stakeholders', 'stakeholders-1', { id: ID.corp, label: '架空事業会社株式会社' });
    expect(next.stakeholders?.[1]).toMatchObject({ include: false, existing: { id: ID.corp }, similar: [] });
    expect(next.shareTransactions?.[1].refs.stakeholderId).toBe(refExisting(ID.corp));
    expect(checkReview('investment_agreement', next, context()).errorCount).toBe(0);
  });

  it('登録済みと一致した行を対象に戻すと、参照も「新しく作る行」に戻る（外すと登録済みに戻る）', () => {
    const included = setRowIncluded(state(), 'stakeholders', 'stakeholders-0', true);
    expect(included.shareTransactions?.[0].refs.stakeholderId).toBe(refNew('stakeholders-0'));
    const excluded = setRowIncluded(included, 'stakeholders', 'stakeholders-0', false);
    expect(excluded.shareTransactions?.[0].refs.stakeholderId).toBe(refExisting(ID.fund));
  });

  it('登録済みと一致していない行を外しても、参照は付け替えない（検証で止まる）', () => {
    const next = setRowIncluded(state(), 'stakeholders', 'stakeholders-2', false);
    expect(next.shareTransactions?.[2].refs.stakeholderId).toBe(refNew('stakeholders-2'));
    expect(checkReview('investment_agreement', next, context()).errorCount).toBe(1);
  });

  it('まとめて対象にする・外す・同じ値を入れる', () => {
    const none = setGroupIncluded(state(), 'shareTransactions', false);
    expect(none.shareTransactions?.every((row) => !row.include)).toBe(true);
    const all = setGroupIncluded(none, 'shareTransactions', true);
    expect(all.shareTransactions?.every((row) => row.include)).toBe(true);
    const dated = setGroupValue(all, 'shareTransactions', 'transactionDate', '2026-09-30');
    expect(dated.shareTransactions?.map((row) => row.values.transactionDate)).toEqual(['2026-09-30', '2026-09-30', '2026-09-30']);
  });

  it('会社情報は、選んだ項目が無くなったら対象から外れる', () => {
    const base = buildReviewState(
      { documentKind: 'registry', summary: '', documentDate: null, warnings: [], groups: { company: [{ capitalAmount: 1 }] } },
      context(),
    );
    expect(base.company?.[0]).toMatchObject({ include: true, ticked: ['capitalAmount'] });
    const off = setCompanyFieldTicked(base, 'company-0', 'capitalAmount', false);
    expect(off.company?.[0]).toMatchObject({ include: false, ticked: [] });
    const on = setCompanyFieldTicked(off, 'company-0', 'address', true);
    expect(on.company?.[0]).toMatchObject({ include: true, ticked: ['address'] });
  });

  it('反映の確認に出す要約は、対象の行だけを数える', () => {
    expect(summarizeApply(state())).toEqual(['株主・権利者: 2 件を新しく登録', '株式の種類: 1 件を新しく登録', '資金調達ラウンド: 1 件を新しく登録', '株式の異動: 3 件を新しく登録']);
    expect(summarizeApply(setGroupIncluded(state(), 'shareTransactions', false))).not.toContain('株式の異動: 3 件を新しく登録');
  });
});

describe('importFile / appliedLinks', () => {
  it('読み取れる形式と大きさだけを通す', () => {
    expect(checkImportFile({ name: '契約書.PDF', size: 1000 })).toBeNull();
    expect(checkImportFile({ name: 'scan.jpeg', size: 5 * 1024 * 1024 })).toBeNull();
    expect(checkImportFile({ name: 'a.docx', size: 1000 })).toContain('PDF');
    expect(checkImportFile({ name: 'a.pdf', size: 0 })).toContain('空');
    expect(checkImportFile({ name: 'a.pdf', size: 21 * 1024 * 1024 })).toContain('20MB');
    expect(formatFileSize(260_861)).toBe('255 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('作った行を見られる画面を返す（会議は、取締役会か株主総会かで分かれる）', () => {
    expect(appliedLinkOf('funding-rounds', [{ id: 'a', label: 'x' }])).toEqual({ path: '/rounds', label: '資金調達・種類株式' });
    expect(appliedLinkOf('meetings', [{ id: 'a', label: 'x', href: '/board-meetings/a' }])).toEqual({ path: '/board-meetings/a', label: '取締役会' });
    expect(appliedLinkOf('unknown', [])).toBeNull();
  });
});
