'use client';

// 優先分配の試算（M&A・みなし清算で、売却額を株式の種類ごとにどう分けるか）。試算であり、定款・株主間契約が優先する。

import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CapTable } from '@/lib/equity/capTable';
import { formatNumber, formatRatio, formatYen, formatYenJa, parseNumberText } from '@/lib/equity/format';
import { optionLabel, PARTICIPATION_TYPES, type ShareClass } from '@/lib/equity/types';
import { computeWaterfall } from '@/lib/equity/waterfall';
import { compactYen, exitValueSeries, waterfallHoldings } from '../services/capTableGrid';

// 種類ごとの色（表示順に固定で割り当てる。5 種類を超えるときはグラフを出さず表だけにする）
const CLASS_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-3)',
  'var(--color-chart-2)',
  'var(--color-chart-4)',
  'var(--color-chart-gray)',
] as const;

interface TooltipEntry {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
}

const WaterfallTooltip = ({ active, payload, label }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: unknown }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-bg-card px-3 py-2 text-[12px] shadow-md">
      <div className="font-semibold text-text-heading">売却額 {String(label)}円</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center gap-2 mt-1 text-text-body">
          <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
          <span>{String(entry.name)}</span>
          <span className="ml-auto pl-4 tabular-nums font-medium text-text-heading">{formatYenJa(Number(entry.value))}</span>
        </div>
      ))}
    </div>
  );
};

export const ExitWaterfall = ({ table, shareClasses }: { table: CapTable; shareClasses: readonly ShareClass[] }) => {
  const [exitText, setExitText] = useState('');
  const parsed = parseNumberText(exitText);
  const exitValue = parsed != null && parsed > 0 ? parsed : null;
  const invalid = exitText.trim() !== '' && exitValue == null;

  const holdings = useMemo(() => waterfallHoldings(table), [table]);
  const classById = useMemo(() => new Map(shareClasses.map((shareClass) => [shareClass.id, shareClass])), [shareClasses]);
  const result = useMemo(
    () => (exitValue != null && holdings.length > 0 ? computeWaterfall(exitValue, shareClasses, holdings) : null),
    [exitValue, shareClasses, holdings],
  );

  // グラフの色は種類の表示順で決める（売却額によって並びが変わっても色は変わらない）
  const orderedClasses = useMemo(
    () => table.classes.filter((shareClass) => holdings.some((holding) => holding.shareClassId === shareClass.shareClassId)),
    [table.classes, holdings],
  );
  const chartData = useMemo(() => {
    if (exitValue == null || holdings.length === 0) return [];
    return exitValueSeries(exitValue).map((value) => {
      const point: Record<string, string | number> = { label: compactYen(value) };
      for (const item of computeWaterfall(value, shareClasses, holdings).classes) point[item.shareClassId] = item.total;
      return point;
    });
  }, [exitValue, shareClasses, holdings]);
  const showChart = chartData.length > 0 && orderedClasses.length <= CLASS_COLORS.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] leading-relaxed text-text-muted m-0">
        株主に分配される総額（売却額）を、株式の種類の優先順位・優先分配の倍率・参加型か非参加型か・転換比率に沿って分けた
        <strong className="font-semibold text-text-main">試算</strong>
        です。実際の分配は<strong className="font-semibold text-text-main">定款・株主間契約</strong>
        （みなし清算条項、未払いの配当、ドラッグ・アロングの条件など）で決まります。発行済みの株式だけを対象にしており、新株予約権の行使や転換型証券の転換は含めていません。
      </p>

      <div className="max-w-[320px]">
        <label htmlFor="waterfall-exit" className="gt-field-label">
          売却額（株主に分配される総額）
        </label>
        <input
          id="waterfall-exit"
          className="gt-field"
          style={{ textAlign: 'right' }}
          inputMode="decimal"
          value={exitText}
          placeholder="30億"
          aria-invalid={invalid || undefined}
          onChange={(event) => setExitText(event.target.value)}
        />
        <p className={`text-[12px] mt-1 mb-0 ${invalid ? 'text-danger' : 'text-text-muted'}`}>
          {invalid ? '数値で入力してください（例: 30億）' : exitValue != null ? `= ${formatYenJa(exitValue)}` : ' '}
        </p>
      </div>

      {holdings.length === 0 ? (
        <p className="gt-table-empty m-0">発行済みの株式がありません。</p>
      ) : !result ? (
        <p className="gt-table-empty m-0">売却額を入れると試算します。</p>
      ) : (
        <>
          {/* 金額の列が 3 つ並ぶので、条件は種類の名前の下に添え、長い見出しは 2 行にして金額に幅を回す */}
          <div className="gt-table-scroll">
            <table className="gt-table [&_th]:align-bottom">
              <thead>
                <tr>
                  <th scope="col">株式の種類・条件</th>
                  <th scope="col" className="gt-num">株式数</th>
                  <th scope="col" className="gt-num">優先分配</th>
                  <th scope="col" className="gt-num">残余の分配</th>
                  <th scope="col" className="gt-num">合計</th>
                  <th scope="col" className="gt-num">
                    売却額に
                    <br />
                    対する割合
                  </th>
                  <th scope="col" className="gt-num">1 株あたり</th>
                </tr>
              </thead>
              <tbody>
                {result.classes.map((item) => {
                  const shareClass = classById.get(item.shareClassId);
                  const isPreferred = shareClass != null && shareClass.kind !== 'common' && (shareClass.originalIssuePrice ?? 0) > 0;
                  return (
                    <tr key={item.shareClassId}>
                      <td>
                        <span className="font-medium">{item.name}</span>
                        {item.converted && <span className="gt-pill gt-pill-sm gt-pill-info ml-2">普通株式に転換して分配</span>}
                        <div className="text-[11.5px] text-text-muted">
                          {isPreferred && shareClass
                            ? `優先順位 ${shareClass.seniority}・${shareClass.liquidationMultiple} 倍・${optionLabel(PARTICIPATION_TYPES, shareClass.participation)}${
                                shareClass.participation === 'capped_participating' && shareClass.participationCapMultiple != null
                                  ? `（${shareClass.participationCapMultiple} 倍まで）`
                                  : ''
                              }`
                            : '優先分配なし'}
                        </div>
                      </td>
                      <td className="gt-num">{formatNumber(item.shares)}</td>
                      <td className="gt-num">{item.preference > 0 ? formatYen(item.preference) : '—'}</td>
                      <td className="gt-num">{item.participation > 0 ? formatYen(item.participation) : '—'}</td>
                      <td className="gt-num font-medium">{formatYen(item.total)}</td>
                      <td className="gt-num">{formatRatio(result.exitValue > 0 ? item.total / result.exitValue : 0)}</td>
                      <td className="gt-num">{formatYen(item.perShare, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td>合計</td>
                  <td className="gt-num">{formatNumber(result.classes.reduce((total, item) => total + item.shares, 0))}</td>
                  <td className="gt-num">{formatYen(result.classes.reduce((total, item) => total + item.preference, 0))}</td>
                  <td className="gt-num">{formatYen(result.classes.reduce((total, item) => total + item.participation, 0))}</td>
                  <td className="gt-num">{formatYen(result.classes.reduce((total, item) => total + item.total, 0))}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {result.undistributed >= 1 && (
            <p className="text-[12px] text-text-muted m-0">円未満の端数処理により、{formatYen(result.undistributed)} が配り切れずに残ります。</p>
          )}

          {showChart && (
            <div>
              <h3 className="text-[14px] font-semibold text-text-heading m-0">売却額による分配の変化（試算）</h3>
              <p className="text-[12px] text-text-muted mt-1 mb-2">入力した売却額の 1/4・1/2・1 倍・2 倍・4 倍の場合の、種類ごとの受取額です。</p>
              <ul className="list-none p-0 m-0 mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-body">
                {orderedClasses.map((shareClass, index) => (
                  <li key={shareClass.shareClassId} className="flex items-center gap-1.5">
                    <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: CLASS_COLORS[index] }} />
                    {shareClass.name}
                  </li>
                ))}
              </ul>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="32%">
                    <CartesianGrid vertical={false} stroke="var(--color-border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--color-border-strong)' }} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
                      tickFormatter={(value: number) => compactYen(value)}
                    />
                    <Tooltip cursor={{ fill: 'var(--color-bg-hover)' }} content={<WaterfallTooltip />} />
                    {orderedClasses.map((shareClass, index) => (
                      <Bar
                        key={shareClass.shareClassId}
                        dataKey={shareClass.shareClassId}
                        name={shareClass.name}
                        stackId="exit"
                        fill={CLASS_COLORS[index]}
                        stroke="var(--color-bg-card)"
                        strokeWidth={1}
                        maxBarSize={56}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
