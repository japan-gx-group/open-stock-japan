// 決算情報の比較（前年同期比）・グラフ用のデータ・AI の下書きの材料。サーバ依存なし。

import { addYears, formatDateJa, formatYen } from '@/lib/equity/format';
import { FINANCIAL_PERIOD_TYPES } from '@/lib/resources/definitions';
import { optionLabel } from '@/lib/equity/types';

/** 比較・グラフに使う決算情報の項目（社内の一覧の行と、株主ポータルの行のどちらも当てはまる） */
export interface FinancialFigures {
  id: string;
  title: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  ordinaryIncome: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  netAssets: number | null;
  cashAndDeposits: number | null;
  interestBearingDebt: number | null;
  employees: number | null;
}

export const FIGURE_KEYS = [
  'revenue',
  'grossProfit',
  'operatingIncome',
  'ordinaryIncome',
  'netIncome',
  'totalAssets',
  'netAssets',
  'cashAndDeposits',
  'interestBearingDebt',
  'employees',
] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

export const FIGURE_LABELS: Record<FigureKey, string> = {
  revenue: '売上高',
  grossProfit: '売上総利益',
  operatingIncome: '営業利益',
  ordinaryIncome: '経常利益',
  netIncome: '当期純利益',
  totalAssets: '総資産',
  netAssets: '純資産',
  cashAndDeposits: '現金及び預金',
  interestBearingDebt: '有利子負債',
  employees: '従業員数',
};

const toNumber = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** API の行（数値が文字列のこともある）を比較用の形にそろえる */
export const toFigures = (row: Record<string, unknown>): FinancialFigures => ({
  id: String(row.id ?? ''),
  title: String(row.title ?? ''),
  periodType: String(row.periodType ?? ''),
  periodStart: String(row.periodStart ?? ''),
  periodEnd: String(row.periodEnd ?? ''),
  revenue: toNumber(row.revenue),
  grossProfit: toNumber(row.grossProfit),
  operatingIncome: toNumber(row.operatingIncome),
  ordinaryIncome: toNumber(row.ordinaryIncome),
  netIncome: toNumber(row.netIncome),
  totalAssets: toNumber(row.totalAssets),
  netAssets: toNumber(row.netAssets),
  cashAndDeposits: toNumber(row.cashAndDeposits),
  interestBearingDebt: toNumber(row.interestBearingDebt),
  employees: toNumber(row.employees),
});

/**
 * 前年の同じ期間（同じ種類で、終了日が 1 年前の同じ月）の決算情報を探す。
 * 通期なら前期、上半期なら前年の上半期。無ければ null。
 */
export const findPreviousComparable = <T extends Pick<FinancialFigures, 'id' | 'periodType' | 'periodEnd'>>(
  report: T,
  all: readonly T[],
): T | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.periodEnd)) return null;
  const targetMonth = addYears(report.periodEnd, -1).slice(0, 7);
  return (
    all.find(
      (other) => other.id !== report.id && other.periodType === report.periodType && other.periodEnd.slice(0, 7) === targetMonth,
    ) ?? null
  );
};

export interface Change {
  current: number | null;
  previous: number | null;
  /** 増減額（どちらかが無ければ null） */
  diff: number | null;
  /** 増減率（0.25 = +25%）。前の値が 0 以下のときは率に意味が無いので null */
  rate: number | null;
}

export const changeOf = (current: number | null, previous: number | null): Change => {
  if (current == null || previous == null) return { current, previous, diff: null, rate: null };
  const diff = current - previous;
  return { current, previous, diff, rate: previous > 0 ? diff / previous : null };
};

export const yearOverYear = (report: FinancialFigures, previous: FinancialFigures | null): Record<FigureKey, Change> => {
  const result = {} as Record<FigureKey, Change>;
  for (const key of FIGURE_KEYS) result[key] = changeOf(report[key], previous ? previous[key] : null);
  return result;
};

/** 「+25.0%」「-3.2%」。率が出せないときは増減額（「+400万円」）、どちらも無ければ「—」 */
export const formatChange = (change: Change, unit: 'yen' | 'people' = 'yen'): string => {
  if (change.diff == null) return '—';
  const sign = change.diff > 0 ? '+' : change.diff < 0 ? '-' : '±';
  if (change.rate != null) return `${sign}${Math.abs(change.rate * 100).toFixed(1)}%`;
  const abs = Math.abs(change.diff);
  return unit === 'people' ? `${sign}${abs.toLocaleString('ja-JP')}人` : `${sign}${formatCompactYen(abs)}`;
};

/** 132,000,000 → 「1.32億円」、-18,000,000 → 「-1,800万円」。グラフの軸・タイルに使う短い表記 */
export const formatCompactYen = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${sign}${trimZeros((abs / 100_000_000).toFixed(2))}億円`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString('ja-JP')}万円`;
  return `${sign}${Math.round(abs).toLocaleString('ja-JP')}円`;
};

const trimZeros = (text: string): string => text.replace(/\.?0+$/, '');

/** 「2025年4月〜2026年3月」 */
export const formatPeriod = (periodStart: string, periodEnd: string): string => {
  const ym = (date: string) => {
    const [year, month] = date.split('-').map(Number);
    return year && month ? `${year}年${month}月` : '—';
  };
  return `${ym(periodStart)}〜${ym(periodEnd)}`;
};

/** グラフの横軸の短い名前（「2026/3期」「2026/9 半期」） */
export const periodAxisLabel = (report: Pick<FinancialFigures, 'periodType' | 'periodEnd'>): string => {
  const [year, month] = report.periodEnd.split('-').map(Number);
  const base = `${year}/${month}`;
  if (report.periodType === 'annual') return `${base}期`;
  return `${base} ${optionLabel(FINANCIAL_PERIOD_TYPES, report.periodType)}`;
};

export interface ChartPoint {
  id: string;
  label: string;
  title: string;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  cashAndDeposits: number | null;
  netAssets: number | null;
}

/** 通期の決算を、期間の古い順に並べたグラフ用のデータ */
export const annualSeries = (reports: readonly FinancialFigures[]): ChartPoint[] =>
  reports
    .filter((report) => report.periodType === 'annual')
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    .map((report) => ({
      id: report.id,
      label: periodAxisLabel(report),
      title: report.title,
      revenue: report.revenue,
      operatingIncome: report.operatingIncome,
      netIncome: report.netIncome,
      cashAndDeposits: report.cashAndDeposits,
      netAssets: report.netAssets,
    }));

const figureLines = (report: FinancialFigures): string[] => {
  const lines: string[] = [];
  for (const key of FIGURE_KEYS) {
    const value = report[key];
    if (value == null) continue;
    lines.push(`- ${FIGURE_LABELS[key]}: ${key === 'employees' ? `${value.toLocaleString('ja-JP')}人` : formatYen(value)}`);
  }
  return lines.length > 0 ? lines : ['- （数字は未入力）'];
};

/** AI にハイライトの下書きを作らせるときの材料（この期間と、前年の同じ期間の数字） */
export const buildHighlightsContext = (
  report: FinancialFigures,
  previous: FinancialFigures | null,
  companyName = '',
): string => {
  const head = (target: FinancialFigures) =>
    `${target.title}（${optionLabel(FINANCIAL_PERIOD_TYPES, target.periodType)}・${formatDateJa(target.periodStart)}〜${formatDateJa(target.periodEnd)}）`;
  const lines = [
    ...(companyName ? [`会社名: ${companyName}`] : []),
    `【今回の決算】${head(report)}`,
    ...figureLines(report),
    '',
    ...(previous
      ? [`【前年の同じ期間】${head(previous)}`, ...figureLines(previous)]
      : ['【前年の同じ期間】登録なし（前期との比較には触れない）']),
    '',
    '金額は円。マイナスは損失（純資産のマイナスは債務超過）。',
  ];
  return lines.join('\n');
};

/** お知らせの下書きの材料に添える、決算の数字の短い要約 */
export const buildFiguresSummary = (report: FinancialFigures): string =>
  [`${report.title}（${formatDateJa(report.periodStart)}〜${formatDateJa(report.periodEnd)}）`, ...figureLines(report)].join('\n');
