'use client';

// 完全希釈化後の比率の横棒グラフ（上位の名義人 ＋ その他 ＋ 未割当枠）。
// 量の比較なので色は 1 色にし、「その他」「未割当枠」だけ中立色にする。値は棒の右に直接書く。

import React from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber, formatRatio } from '@/lib/equity/format';
import type { OwnershipSlice } from '../services/overview';

// 「○○1号投資事業有限責任組合」（14 文字）までは省略せずに出せる幅
const NAME_WIDTH = 184;
const MAX_NAME_LENGTH = 14;

const shorten = (name: string): string => (name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name);

const NameTick = ({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) => {
  const name = String(payload?.value ?? '');
  return (
    <text x={Number(x ?? 0)} y={Number(y ?? 0)} dy={4} textAnchor="end" fontSize={12.5} fill="var(--color-text-body)">
      <title>{name}</title>
      {shorten(name)}
    </text>
  );
};

const OwnershipTooltip = ({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) => {
  const slice = payload?.[0]?.payload as OwnershipSlice | undefined;
  if (!active || !slice) return null;
  return (
    <div className="rounded-md border border-border bg-bg-card px-3 py-2 text-[12px] shadow-md">
      <div className="font-semibold text-text-heading">{slice.name}</div>
      <div className="mt-1 text-text-body tabular-nums">
        完全希釈化後 {formatRatio(slice.ratio)}（{formatNumber(slice.shares)}株）
      </div>
    </div>
  );
};

export const OwnershipChart = ({ slices }: { slices: OwnershipSlice[] }) => {
  const data = slices.map((slice) => ({ ...slice, percent: Number((slice.ratio * 100).toFixed(2)) }));
  const max = Math.max(...data.map((item) => item.percent), 1);
  return (
    <div style={{ width: '100%', height: Math.max(120, data.length * 34 + 16) }} role="img" aria-label="完全希釈化後の比率の横棒グラフ">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 0 }} barCategoryGap="28%">
          <XAxis type="number" domain={[0, Math.ceil(max / 10) * 10]} hide />
          <YAxis type="category" dataKey="name" width={NAME_WIDTH} tickLine={false} axisLine={false} interval={0} tick={<NameTick />} />
          <Tooltip cursor={{ fill: 'var(--color-bg-hover)' }} content={<OwnershipTooltip />} />
          <Bar dataKey="percent" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} background={{ fill: 'var(--color-chart-track)', radius: 4 }}>
            {data.map((item) => (
              <Cell key={item.key} fill={item.kind === 'holder' ? 'var(--color-chart-1)' : 'var(--color-chart-gray)'} />
            ))}
            <LabelList
              dataKey="percent"
              position="right"
              formatter={(value: unknown) => `${Number(value).toFixed(2)}%`}
              style={{ fontSize: 12, fill: 'var(--color-text-heading)', fontVariantNumeric: 'tabular-nums' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
