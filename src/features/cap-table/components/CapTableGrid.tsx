// 資本政策表の本体（名義人 × 種類ごとの発行済株式・潜在株式・完全希釈化後の比率）。
// 表示だけを受け持ち、計算は buildCapTable の結果をそのまま並べる。

import type { CapTable } from '@/lib/equity/capTable';
import { formatNumber, formatRatio, formatYenJa } from '@/lib/equity/format';
import { issuedClasses, rowKindLabel } from '../services/capTableGrid';

const zeroAsDash = (value: number): string => (value === 0 ? '—' : formatNumber(value));

// 列が多く、種類が増えると横にスクロールする表なので、1 列目（株主・権利者）は左に固定する。
// 固定したセルが自分の罫線を持って動くよう、この表だけ罫線を分離（間隔 0）にする。
// 分離にすると合計行の上で本文の罫線と二重になるため、本文の最終行の下の線は引かない。
const STICKY_TABLE = 'border-separate border-spacing-0 [&_tbody>tr:last-child>td]:border-b-0';
// 右の線は、横にスクロールしたとき数字の列との境目になる
const STICKY_CELL = 'sticky left-0 z-[1] bg-bg-card shadow-[inset_-1px_0_0_var(--color-border)]';

// 氏名・名称。14 文字ほどまでは折り返さず、それより長い名称だけ、その幅で折り返す（短い氏名だけなら列は広がらない）
const NAME_CLASS = 'block w-max max-w-[14.5em] whitespace-normal text-[13.5px] font-medium text-text-heading';

// 数字の列が 10 前後並ぶので、列の間隔だけ標準（左右 12px）より詰める。両端はカードの見出しの位置のまま
const DENSE_COLUMNS =
  '[&_th:not(:first-child)]:pl-2 [&_th:not(:last-child)]:pr-2 [&_td:not(:first-child)]:pl-2 [&_td:not(:last-child)]:pr-2';

export const CapTableGrid = ({ table, caption }: { table: CapTable; caption?: string }) => {
  const classes = issuedClasses(table);
  const hasNewShares = table.totals.newShares > 0;
  const { totals } = table;
  const poolShown = table.rows.some((row) => row.kind === 'pool');

  if (table.rows.length === 0) {
    return <p className="gt-table-empty m-0">この条件で表示できる株主・権利者がいません。</p>;
  }

  return (
    <div className="gt-table-scroll relative">
      {/* 見出しは「名前／単位」の 2 行にして列を狭くする。1 行の見出しは下にそろえる */}
      <table className={`gt-table [&_th]:align-bottom ${STICKY_TABLE} ${DENSE_COLUMNS}`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            <th scope="col" className={STICKY_CELL}>
              株主・権利者
            </th>
            {classes.map((shareClass) => (
              <th key={shareClass.shareClassId} scope="col" className="gt-num">
                {shareClass.name}
              </th>
            ))}
            <th scope="col" className="gt-num">発行済合計</th>
            <th scope="col" className="gt-num">持株比率</th>
            <th scope="col" className="gt-num">議決権比率</th>
            <th scope="col" className="gt-num">
              新株予約権
              <br />
              （株）
            </th>
            <th scope="col" className="gt-num">
              転換型
              <br />
              （株・概算）
            </th>
            {hasNewShares && (
              <th scope="col" className="gt-num">
                新規引受
                <br />
                （株）
              </th>
            )}
            <th scope="col" className="gt-num">
              完全希釈化後
              <br />
              （株）
            </th>
            <th scope="col" className="gt-num">
              完全希釈化後
              <br />
              比率
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.stakeholderId}>
              {/* 区分（個人・法人など）は氏名の下に添える（セルの文字は区分の大きさ・色にし、氏名だけ本文の大きさに戻す）。
                  氏名は 14 文字ほどまで 1 行に収め、それより長い名称だけ折り返す */}
              <td className={`text-[11.5px] text-text-muted ${STICKY_CELL}`}>
                <span className={NAME_CLASS}>{row.name}</span>
                {rowKindLabel(row.kind)}
              </td>
              {classes.map((shareClass) => (
                <td key={shareClass.shareClassId} className="gt-num">
                  {zeroAsDash(row.sharesByClass[shareClass.shareClassId] ?? 0)}
                </td>
              ))}
              <td className="gt-num">{zeroAsDash(row.issuedShares)}</td>
              <td className="gt-num">{row.issuedShares === 0 ? '—' : formatRatio(row.issuedRatio)}</td>
              <td className="gt-num">{row.votingShares === 0 ? '—' : formatRatio(row.votingRatio)}</td>
              <td className="gt-num">{zeroAsDash(row.optionShares)}</td>
              <td className="gt-num">
                {row.convertibleAmount === 0 ? (
                  '—'
                ) : (
                  <>
                    {row.convertibleShares > 0 ? formatNumber(row.convertibleShares) : '未確定'}
                    <div className="text-[11.5px] text-text-muted">{formatYenJa(row.convertibleAmount)}</div>
                  </>
                )}
              </td>
              {hasNewShares && <td className="gt-num">{zeroAsDash(row.newShares)}</td>}
              <td className="gt-num font-medium">{formatNumber(row.fullyDilutedShares)}</td>
              <td className="gt-num font-medium">{formatRatio(row.fullyDilutedRatio)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className={STICKY_CELL}>合計</td>
            {classes.map((shareClass) => (
              <td key={shareClass.shareClassId} className="gt-num">
                {formatNumber(shareClass.issuedShares)}
              </td>
            ))}
            <td className="gt-num">{formatNumber(totals.issuedShares)}</td>
            <td className="gt-num">{totals.issuedShares > 0 ? formatRatio(1) : '—'}</td>
            <td className="gt-num">{totals.votingShares > 0 ? formatRatio(1) : '—'}</td>
            <td className="gt-num">{formatNumber(totals.optionShares + (poolShown ? totals.unallocatedPoolShares : 0))}</td>
            <td className="gt-num">
              {totals.convertibleAmount === 0 ? (
                '—'
              ) : (
                <>
                  {formatNumber(totals.convertibleShares)}
                  <div className="text-[11.5px] font-normal text-text-muted">{formatYenJa(totals.convertibleAmount)}</div>
                </>
              )}
            </td>
            {hasNewShares && <td className="gt-num">{formatNumber(totals.newShares)}</td>}
            <td className="gt-num">{formatNumber(totals.fullyDilutedShares)}</td>
            <td className="gt-num">{totals.fullyDilutedShares > 0 ? formatRatio(1) : '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
