import { describe, expect, it } from 'vitest';
import {
  annualSeries,
  buildHighlightsContext,
  changeOf,
  findPreviousComparable,
  formatChange,
  formatCompactYen,
  formatPeriod,
  periodAxisLabel,
  toFigures,
  yearOverYear,
  type FinancialFigures,
} from '../analysis';

const report = (id: string, periodType: string, periodStart: string, periodEnd: string, patch: Partial<FinancialFigures> = {}): FinancialFigures => ({
  ...toFigures({ id, title: id, periodType, periodStart, periodEnd }),
  ...patch,
});

const fy2 = report('fy2', 'annual', '2024-04-01', '2025-03-31', { revenue: 48_000_000, operatingIncome: -22_000_000, netAssets: 10_000_000, employees: 6 });
const fy3 = report('fy3', 'annual', '2025-04-01', '2026-03-31', { revenue: 132_000_000, operatingIncome: -18_000_000, netAssets: -30_600_000, employees: 11 });
const h1fy3 = report('h1fy3', 'half', '2025-04-01', '2025-09-30', { revenue: 60_000_000 });
const h1fy4 = report('h1fy4', 'half', '2026-04-01', '2026-09-30', { revenue: 104_000_000 });
const all = [h1fy4, fy3, h1fy3, fy2];

describe('前年の同じ期間', () => {
  it('同じ種類で 1 年前に終わる期間を選ぶ', () => {
    expect(findPreviousComparable(fy3, all)?.id).toBe('fy2');
    expect(findPreviousComparable(h1fy4, all)?.id).toBe('h1fy3');
  });
  it('通期と半期を混ぜない。無ければ null', () => {
    expect(findPreviousComparable(fy2, all)).toBeNull();
    expect(findPreviousComparable(h1fy3, all)).toBeNull();
    expect(findPreviousComparable(report('x', 'annual', '', ''), all)).toBeNull();
  });
  it('月末の日付がずれていても同じ月なら対応させる（うるう年の 2 月など）', () => {
    const a = report('a', 'annual', '2023-03-01', '2024-02-29');
    const b = report('b', 'annual', '2024-03-01', '2025-02-28');
    expect(findPreviousComparable(b, [a, b])?.id).toBe('a');
  });
});

describe('増減', () => {
  it('増減額と増減率', () => {
    expect(changeOf(132, 48)).toEqual({ current: 132, previous: 48, diff: 84, rate: 1.75 });
    expect(changeOf(90, 100).rate).toBeCloseTo(-0.1);
  });
  it('前の値が 0 以下のときは率を出さない（赤字からの増減率は意味が無い）', () => {
    expect(changeOf(-18, -22)).toEqual({ current: -18, previous: -22, diff: 4, rate: null });
    expect(changeOf(5, 0).rate).toBeNull();
  });
  it('どちらかが無ければ比較しない', () => {
    expect(changeOf(null, 5)).toEqual({ current: null, previous: 5, diff: null, rate: null });
    expect(changeOf(5, null).diff).toBeNull();
  });
  it('決算どうしの比較', () => {
    const yoy = yearOverYear(fy3, fy2);
    expect(yoy.revenue.rate).toBeCloseTo(1.75);
    expect(yoy.operatingIncome).toMatchObject({ diff: 4_000_000, rate: null });
    expect(yoy.netAssets).toMatchObject({ diff: -40_600_000, rate: -4.06 });
    expect(yoy.grossProfit.diff).toBeNull();
    expect(yearOverYear(fy3, null).revenue.diff).toBeNull();
  });
  it('表示', () => {
    expect(formatChange(changeOf(132, 48))).toBe('+175.0%');
    expect(formatChange(changeOf(90, 100))).toBe('-10.0%');
    expect(formatChange(changeOf(-18_000_000, -22_000_000))).toBe('+400万円');
    expect(formatChange(changeOf(11, 0), 'people')).toBe('+11人');
    expect(formatChange(changeOf(5, 5))).toBe('±0.0%');
    expect(formatChange(changeOf(null, 5))).toBe('—');
  });
});

describe('表記', () => {
  it('短い金額', () => {
    expect(formatCompactYen(132_000_000)).toBe('1.32億円');
    expect(formatCompactYen(100_000_000)).toBe('1億円');
    expect(formatCompactYen(-18_000_000)).toBe('-1,800万円');
    expect(formatCompactYen(9_999)).toBe('9,999円');
    expect(formatCompactYen(0)).toBe('0円');
    expect(formatCompactYen(null)).toBe('—');
  });
  it('期間', () => {
    expect(formatPeriod('2025-04-01', '2026-03-31')).toBe('2025年4月〜2026年3月');
    expect(periodAxisLabel(fy3)).toBe('2026/3期');
    expect(periodAxisLabel(h1fy4)).toBe('2026/9 半期');
  });
});

describe('グラフ用のデータ', () => {
  it('通期だけを古い順に並べ、損失は負のまま渡す', () => {
    const series = annualSeries(all);
    expect(series.map((point) => point.id)).toEqual(['fy2', 'fy3']);
    expect(series[1]).toMatchObject({ label: '2026/3期', revenue: 132_000_000, operatingIncome: -18_000_000, netAssets: -30_600_000, cashAndDeposits: null });
  });
});

describe('AI の下書きの材料', () => {
  it('今回と前年の数字を並べ、未入力の項目は書かない', () => {
    const context = buildHighlightsContext(fy3, fy2, '架空株式会社');
    expect(context).toContain('会社名: 架空株式会社');
    expect(context).toContain('- 売上高: 132,000,000円');
    expect(context).toContain('- 営業利益: -18,000,000円');
    expect(context).toContain('【前年の同じ期間】fy2');
    expect(context).toContain('- 売上高: 48,000,000円');
    expect(context).toContain('- 従業員数: 11人');
    expect(context).not.toContain('売上総利益');
  });
  it('前年が無ければ、比較に触れないよう明記する', () => {
    expect(buildHighlightsContext(fy2, null)).toContain('登録なし');
  });
});

describe('toFigures', () => {
  it('文字列の数値を数にし、空は null にする', () => {
    const figures = toFigures({ id: 'a', revenue: '100', netIncome: '', totalAssets: 'x', employees: 0 });
    expect(figures.revenue).toBe(100);
    expect(figures.netIncome).toBeNull();
    expect(figures.totalAssets).toBeNull();
    expect(figures.employees).toBe(0);
  });
});
