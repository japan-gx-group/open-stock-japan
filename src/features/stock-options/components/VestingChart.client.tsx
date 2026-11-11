'use client';

// 1 件の割当のベスティング予定（確定済みの個数の推移）。確定は区切りの日に段階的に増えるので階段状に描く。
import React, { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateJa, formatUnits } from '@/lib/equity/format';
import type { OptionGrant, OptionPlan } from '@/lib/equity/types';
import { vestingSchedule } from '../services/optionSummary';

const toTime = (date: string): number => new Date(`${date}T00:00:00Z`).getTime();
const toDate = (time: number): string => new Date(time).toISOString().slice(0, 10);

export const VestingChart = ({ grant, plan, today }: { grant: OptionGrant; plan: OptionPlan; today: string }) => {
  const data = useMemo(
    () => vestingSchedule(grant, plan).map((point) => ({ time: toTime(point.date), vestedUnits: point.vestedUnits })),
    [grant, plan],
  );

  if (data.length < 2) {
    return <p className="text-[12.5px] text-text-muted m-0">この回次にはベスティングの定めが無く、割当の全量が確定済みの扱いです。</p>;
  }
  const first = data[0].time;
  const last = data[data.length - 1].time;
  const todayTime = toTime(today);

  return (
    <div
      role="img"
      aria-label={`ベスティング予定。${formatDateJa(toDate(first))} に起算し、${formatDateJa(toDate(last))} に ${formatUnits(grant.units)} の全量が確定します。`}
      style={{ width: '100%', height: 190 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 18, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={[first, last]}
            tickFormatter={(time: number) => toDate(time).slice(0, 7).replace('-', '/')}
            tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border-strong)' }}
            minTickGap={48}
          />
          <YAxis
            domain={[0, grant.units]}
            tickFormatter={(value: number) => value.toLocaleString('ja-JP')}
            tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            formatter={(value) => [formatUnits(Number(value)), '確定済み']}
            labelFormatter={(time) => formatDateJa(toDate(Number(time)))}
            contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--color-border-strong)' }}
          />
          <Area
            type="stepAfter"
            dataKey="vestedUnits"
            stroke="var(--color-primary)"
            strokeWidth={2}
            fill="var(--color-primary)"
            fillOpacity={0.12}
            isAnimationActive={false}
          />
          {todayTime >= first && todayTime <= last && (
            <ReferenceLine
              x={todayTime}
              stroke="var(--color-text-muted)"
              strokeDasharray="3 3"
              label={{ value: '今日', position: 'top', fontSize: 11, fill: 'var(--color-text-muted)' }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
