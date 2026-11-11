import { describe, expect, it } from 'vitest';
import { shareClass, stakeholder, transaction } from '@/lib/equity/__tests__/fixture';
import { emptySnapshot } from '@/lib/equity/types';
import { buildUpdateDraftContext, shareholderContacts } from '../draftContext';

describe('buildUpdateDraftContext', () => {
  it('メモと種類・タイトルを並べる。決算は渡したときだけ', () => {
    const base = { companyName: '架空株式会社', title: '10月の月次レポート', category: 'monthly_report', memo: ' 新規契約 3 社 ' };
    const without = buildUpdateDraftContext(base);
    expect(without).toContain('会社名: 架空株式会社');
    expect(without).toContain('お知らせの種類: 月次レポート');
    expect(without).toContain('新規契約 3 社');
    expect(without).not.toContain('決算');
    const withFigures = buildUpdateDraftContext({ ...base, figuresSummary: '第3期\n- 売上高: 100円' });
    expect(withFigures).toContain('【株主に公開済みの最新の決算】\n第3期\n- 売上高: 100円');
  });
  it('メモが空でも材料として成り立つ', () => {
    expect(buildUpdateDraftContext({ title: 't', category: 'news', memo: '' })).toContain('（メモなし）');
  });
});

describe('shareholderContacts', () => {
  it('いま株式を持っている株主のメールだけを、重複なしで返す', () => {
    const snapshot = {
      ...emptySnapshot(),
      stakeholders: [
        stakeholder('s1', '太郎', { email: 'Taro@Example.com' }),
        stakeholder('s2', '花子', { email: null }),
        stakeholder('s3', '売却済み', { email: 'sold@example.com' }),
        stakeholder('s4', 'SO だけ', { email: 'so@example.com' }),
        stakeholder('s5', '同じ宛先', { email: 'taro@example.com' }),
      ],
      shareClasses: [shareClass('c1', '普通株式')],
      shareTransactions: [
        transaction('s1', 'c1', '2024-01-01', 100),
        transaction('s2', 'c1', '2024-01-01', 50),
        transaction('s3', 'c1', '2024-01-01', 10),
        transaction('s3', 'c1', '2025-01-01', -10, { transactionType: 'transfer' }),
        transaction('s5', 'c1', '2024-01-01', 5),
      ],
    };
    expect(shareholderContacts(snapshot)).toEqual({ emails: ['taro@example.com'], missing: ['花子'], shareholderCount: 3 });
  });
});
