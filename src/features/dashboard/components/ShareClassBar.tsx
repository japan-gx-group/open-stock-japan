// 株式の種類ごとの発行済株式の内訳（1 本の積み上げ棒と、数字つきの凡例）。
// 凡例に名前・株式数・割合を書くので、色だけに頼らず読める。

import type { ShareClassTotal } from '@/lib/equity/capTable';
import { formatNumber, formatRatio } from '@/lib/equity/format';

// 表示順に固定で割り当てる。色数を超える種類は中立色にまとめて描く
const COLORS = ['var(--color-chart-1)', 'var(--color-chart-3)', 'var(--color-chart-2)', 'var(--color-chart-4)'] as const;
const REST_COLOR = 'var(--color-chart-gray)';

export const ShareClassBar = ({ classes, totalShares }: { classes: ShareClassTotal[]; totalShares: number }) => {
  const issued = classes.filter((shareClass) => shareClass.issuedShares > 0);
  if (issued.length === 0 || totalShares <= 0) return <p className="gt-table-empty m-0">発行済みの株式がありません。</p>;
  const colorOf = (index: number): string => COLORS[index] ?? REST_COLOR;
  return (
    <div>
      <div className="flex w-full overflow-hidden rounded" style={{ height: '14px', gap: '2px' }} aria-hidden="true">
        {issued.map((shareClass, index) => (
          <div
            key={shareClass.shareClassId}
            title={`${shareClass.name} ${formatRatio(shareClass.issuedShares / totalShares)}`}
            style={{ width: `${(shareClass.issuedShares / totalShares) * 100}%`, minWidth: '3px', backgroundColor: colorOf(index) }}
          />
        ))}
      </div>
      {/* カードの幅が狭い（5 列中 2 列ぶん）ので、見出しは短くする。発行済株式の内訳であることはカードの見出しに書いてある */}
      <div className="gt-table-scroll mt-2">
        <table className="gt-table">
          <thead>
            <tr>
              <th scope="col">株式の種類</th>
              <th scope="col" className="gt-num" title="発行済株式数">
                株式数
              </th>
              <th scope="col" className="gt-num">割合</th>
              <th scope="col" className="gt-num">株主数</th>
            </tr>
          </thead>
          <tbody>
            {issued.map((shareClass, index) => (
              <tr key={shareClass.shareClassId}>
                <td>
                  <span className="inline-block size-2.5 rounded-sm mr-2 align-middle" style={{ backgroundColor: colorOf(index) }} aria-hidden="true" />
                  {shareClass.name}
                </td>
                <td className="gt-num">{formatNumber(shareClass.issuedShares)}</td>
                <td className="gt-num">{formatRatio(shareClass.issuedShares / totalShares)}</td>
                <td className="gt-num">{formatNumber(shareClass.holderCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
