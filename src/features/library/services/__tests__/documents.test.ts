import { describe, expect, it } from 'vitest';
import { buildShareUrl, describeEntity, filterDocuments, type EntityTitles } from '../documents';
import { formatBytes, formatDateTimeJa, isoToTokyoDate } from '../format';

const doc = (title: string, patch: Record<string, string> = {}) => ({
  title,
  fileName: `${title}.pdf`,
  description: '',
  category: 'other',
  visibility: 'internal' as 'internal' | 'shareholders' | 'restricted',
  ...patch,
});

describe('filterDocuments', () => {
  const documents = [
    doc('定款', { category: 'articles' }),
    doc('第3期 計算書類', { category: 'financial', visibility: 'shareholders', description: '定時株主総会で承認' }),
    doc('投資契約書 ＡＢＣ', { category: 'investment_agreement', visibility: 'restricted', fileName: 'Investment-Agreement.PDF' }),
  ];
  const none = { category: '', visibility: '', search: '' };
  it('条件なしはすべて', () => {
    expect(filterDocuments(documents, none)).toHaveLength(3);
  });
  it('分類・公開範囲で絞る', () => {
    expect(filterDocuments(documents, { ...none, category: 'financial' }).map((d) => d.title)).toEqual(['第3期 計算書類']);
    expect(filterDocuments(documents, { ...none, visibility: 'restricted' }).map((d) => d.title)).toEqual(['投資契約書 ＡＢＣ']);
    expect(filterDocuments(documents, { ...none, category: 'articles', visibility: 'shareholders' })).toEqual([]);
  });
  it('キーワードはタイトル・ファイル名・説明を見る。全角半角・大文字小文字を区別しない。空白区切りは AND', () => {
    expect(filterDocuments(documents, { ...none, search: '承認' }).map((d) => d.title)).toEqual(['第3期 計算書類']);
    expect(filterDocuments(documents, { ...none, search: 'abc' }).map((d) => d.title)).toEqual(['投資契約書 ＡＢＣ']);
    expect(filterDocuments(documents, { ...none, search: 'agreement pdf' }).map((d) => d.title)).toEqual(['投資契約書 ＡＢＣ']);
    expect(filterDocuments(documents, { ...none, search: '第３期　計算' }).map((d) => d.title)).toEqual(['第3期 計算書類']);
    expect(filterDocuments(documents, { ...none, search: '定款 無い' })).toEqual([]);
  });
});

describe('describeEntity', () => {
  const titles: EntityTitles = {
    meetings: new Map([
      ['m1', { title: '第3期 定時株主総会', meetingType: 'agm' }],
      ['m2', { title: '第12回 取締役会', meetingType: 'board' }],
    ]),
    financialReports: new Map([['f1', '第3期 決算']]),
    updates: new Map([['u1', '月次レポート']]),
  };
  it('関連するレコードの名前と画面', () => {
    expect(describeEntity({ entityType: 'meeting', entityId: 'm1' }, titles)).toEqual({ label: '株主総会: 第3期 定時株主総会', path: '/shareholder-meetings' });
    expect(describeEntity({ entityType: 'meeting', entityId: 'm2' }, titles)).toEqual({ label: '取締役会: 第12回 取締役会', path: '/board-meetings' });
    expect(describeEntity({ entityType: 'financial_report', entityId: 'f1' }, titles)).toEqual({ label: '決算情報: 第3期 決算', path: '/financials' });
    expect(describeEntity({ entityType: 'shareholder_update', entityId: 'u1' }, titles)?.label).toBe('お知らせ: 月次レポート');
  });
  it('名前が分からないときは種類だけ。関連なし・未知の種類は null', () => {
    expect(describeEntity({ entityType: 'meeting', entityId: 'x' }, titles)).toEqual({ label: '会議', path: '/shareholder-meetings' });
    expect(describeEntity({ entityType: 'option_plan', entityId: 'p' }, titles)).toEqual({ label: 'ストックオプション', path: '/stock-options' });
    expect(describeEntity({ entityType: null, entityId: null }, titles)).toBeNull();
    expect(describeEntity({ entityType: 'unknown', entityId: 'x' }, titles)).toBeNull();
  });
});

describe('表示用の関数', () => {
  it('ファイルの大きさ', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
    expect(formatBytes(null)).toBe('—');
  });
  it('日時は日本時間', () => {
    expect(formatDateTimeJa('2026-11-10T15:05:00Z')).toBe('2026年11月11日 0:05');
    expect(isoToTokyoDate('2026-11-10T15:05:00Z')).toBe('2026-11-11');
    expect(formatDateTimeJa(null)).toBe('—');
    expect(isoToTokyoDate('x')).toBeNull();
  });
  it('共有リンクの URL', () => {
    expect(buildShareUrl('https://example.com/', 'tok')).toBe('https://example.com/share/tok');
  });
});
