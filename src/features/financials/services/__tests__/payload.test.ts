import { describe, expect, it } from 'vitest';
import { DEFAULT_GOVERNANCE, LEGAL } from '@/lib/legal/rules';
import { parseResourceInput } from '@/lib/resources/fields';
import { RESOURCES } from '@/lib/resources/definitions';
import { buildLegalNotes } from '../legalNotes';
import { fullRowPayload } from '../payload';

describe('fullRowPayload', () => {
  const row = {
    id: 'r1', title: '第3期 決算', periodType: 'annual', periodStart: '2025-04-01', periodEnd: '2026-03-31', fiscalYearId: null, status: 'approved',
    revenue: 132000000, grossProfit: null, operatingIncome: -18000000, ordinaryIncome: null, netIncome: -18600000, totalAssets: null, netAssets: -30600000,
    cashAndDeposits: 34000000, interestBearingDebt: null, employees: 11, approvedMeetingId: 'ee000000-0000-0000-0000-000000000001',
    isPublishedToShareholders: false, highlights: '元の文', publishedAt: null, createdAt: 'x', updatedAt: 'y',
  };

  it('定義にある全項目を送り、指定した項目だけを変える（サーバが決める列は送らない）', () => {
    const payload = fullRowPayload('financial-reports', row, { highlights: '新しい文' });
    expect(Object.keys(payload).sort()).toEqual(RESOURCES['financial-reports'].fields.map((field) => field.key).sort());
    expect(payload.highlights).toBe('新しい文');
    expect(payload.revenue).toBe(132000000);
    expect(payload).not.toHaveProperty('publishedAt');
    expect(payload).not.toHaveProperty('id');
  });

  it('そのままサーバの検証を通り、他の項目が元の値のまま保存される', () => {
    const parsed = parseResourceInput(RESOURCES['financial-reports'], fullRowPayload('financial-reports', row, { isPublishedToShareholders: true }), 'update');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.values).toMatchObject({
      title: '第3期 決算', revenue: 132000000, operatingIncome: -18000000, grossProfit: null, employees: 11, highlights: '元の文',
      isPublishedToShareholders: true, approvedMeetingId: 'ee000000-0000-0000-0000-000000000001', fiscalYearId: null,
    });
  });

  it('定義に無い項目を変えようとしたら失敗する', () => {
    expect(() => fullRowPayload('financial-reports', row, { publishedAt: 'x' })).toThrow();
  });

  it('お知らせも同じ', () => {
    const update = { id: 'u', title: 't', category: 'news', status: 'draft', meetingId: null, body: 'b' };
    const parsed = parseResourceInput(RESOURCES['shareholder-updates'], fullRowPayload('shareholder-updates', update, { status: 'published' }), 'update');
    expect(parsed.ok && parsed.values).toEqual({ title: 't', category: 'news', status: 'published', meetingId: null, body: 'b' });
  });
});

describe('buildLegalNotes', () => {
  it('事業年度の末日から、総会の期限の目安と申告期限を出す', () => {
    const notes = buildLegalNotes('2026-03-31', DEFAULT_GOVERNANCE, null);
    const byKey = Object.fromEntries(notes.map((note) => [note.key, note]));
    expect(byKey.approval.date).toBe('2026-06-30');
    expect(byKey.tax_return.date).toBe('2026-05-31');
    expect(byKey.display.date).toBeNull();
    expect(byKey.public_notice.date).toBeNull();
  });
  it('総会の日が分かれば備置きの開始日を出す（取締役会の有無で変わる）', () => {
    const withBoard = buildLegalNotes('2026-03-31', DEFAULT_GOVERNANCE, '2026-06-26').find((note) => note.key === 'display');
    expect(withBoard?.date).toBe('2026-06-12');
    expect(withBoard?.body).toContain('2 週間前');
    expect(withBoard?.body).toContain(`${LEGAL.financialStatementsRetentionYears} 年間`);
    expect(withBoard?.body).toContain('2031年6月12日');
    const noBoard = buildLegalNotes('2026-03-31', { ...DEFAULT_GOVERNANCE, hasBoardOfDirectors: false }, '2026-06-26').find((note) => note.key === 'display');
    expect(noBoard?.date).toBe('2026-06-19');
    expect(noBoard?.body).toContain('1 週間前');
  });
  it('末日が分からなければ日付なしの説明だけ', () => {
    expect(buildLegalNotes(null, DEFAULT_GOVERNANCE, null).every((note) => note.date == null)).toBe(true);
  });
});
