'use client';

// 決算の推移のグラフ（通期）。社内の決算情報の画面と、株主ポータルの決算情報で共通に使う。
//   左: 売上高・営業利益・当期純利益（期ごとの棒。損失は 0 の線より下に伸びる）
//   右: 現金及び預金・純資産（折れ線。債務超過は 0 の線より下）
// 数値の表は各画面の一覧にあるので、ここは形（増減の向き）を見せる役割に絞る。

import React from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompactYen, type ChartPoint } from '../services/analysis';

// 系列の色（色覚の違いがあっても見分けられる組み合わせを検証済み。順番は固定で、系列が減っても塗り替えない）
const SERIES = {
  revenue: { label: '売上高', color: '#4468b8' },
  operatingIncome: { label: '営業利益', color: '#b5762a' },
  netIncome: { label: '当期純利益', color: '#2a9070' },
  cashAndDeposits: { label: '現金及び預金', color: '#4468b8' },
  netAssets: { label: '純資産', color: '#b5762a' },
} as const;

const AXIS = { fontSize: 11, fill: 'var(--color-text-muted)' };
const GRID = 'var(--color-border)';

const tooltipFormatter = (value: unknown, name: unknown): [string, string] => [
  typeof value === 'number' ? formatCompactYen(value) : '—',
  String(name ?? ''),
];

const tooltipProps = {
  formatter: tooltipFormatter,
  contentStyle: {
    borderRadius: 8,
    border: '1px solid var(--color-border-strong)',
    fontSize: 12,
    color: 'var(--color-text-main)',
  },
  labelStyle: { fontWeight: 600, marginBottom: 4, color: 'var(--color-text-heading)' },
  itemStyle: { color: 'var(--color-text-body)' },
} as const;

const legendProps = {
  // 凡例は系列を定義した順のまま出す（名前順に並べ替えない）
  itemSorter: null,
  iconSize: 9,
  wrapperStyle: { fontSize: 12, color: 'var(--color-text-body)' },
  formatter: (value: unknown) => <span style={{ color: 'var(--color-text-body)' }}>{String(value)}</span>,
} as const;

const ChartCard = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
  <div className="gt-card min-w-0" style={{ padding: '16px 18px' }}>
    <div className="text-[13.5px] font-semibold text-text-heading">{title}</div>
    <div className="text-[12px] text-text-muted mt-[2px] mb-3">{sub}</div>
    <div style={{ width: '100%', height: 250 }}>{children}</div>
  </div>
);

export const FinancialCharts = ({ points }: { points: ChartPoint[] }) => {
  if (points.length === 0) return null;
  const single = points.length === 1;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <ChartCard title="売上高と利益" sub="通期。損失は 0 の線より下に表示されます">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={64} tickFormatter={(value: number) => formatCompactYen(value)} />
            <Tooltip {...tooltipProps} cursor={{ fill: 'var(--color-bg-hover)' }} />
            <Legend {...legendProps} />
            <ReferenceLine y={0} stroke="var(--color-text-subtle)" />
            <Bar dataKey="revenue" name={SERIES.revenue.label} fill={SERIES.revenue.color} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="operatingIncome" name={SERIES.operatingIncome.label} fill={SERIES.operatingIncome.color} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="netIncome" name={SERIES.netIncome.label} fill={SERIES.netIncome.color} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="現金及び預金と純資産" sub="各期末の残高。純資産が 0 の線より下なら債務超過です">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} padding={{ left: 24, right: 24 }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={64} tickFormatter={(value: number) => formatCompactYen(value)} />
            <Tooltip {...tooltipProps} cursor={{ stroke: 'var(--color-border-strong)' }} />
            <Legend {...legendProps} />
            <ReferenceLine y={0} stroke="var(--color-text-subtle)" />
            <Line
              type="linear"
              dataKey="cashAndDeposits"
              name={SERIES.cashAndDeposits.label}
              stroke={SERIES.cashAndDeposits.color}
              strokeWidth={2}
              dot={{ r: single ? 5 : 4, strokeWidth: 2, stroke: 'var(--color-bg-card)', fill: SERIES.cashAndDeposits.color }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="netAssets"
              name={SERIES.netAssets.label}
              stroke={SERIES.netAssets.color}
              strokeWidth={2}
              dot={{ r: single ? 5 : 4, strokeWidth: 2, stroke: 'var(--color-bg-card)', fill: SERIES.netAssets.color }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
};
