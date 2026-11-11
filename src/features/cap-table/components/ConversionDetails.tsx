// 転換型証券（J-KISS 等）の回次ごとの転換の内訳。数字はすべて概算で、契約書の定義が優先する。

import type { ConversionDetail } from '@/lib/equity/capTable';
import { formatNumber, formatRatio, formatYen, formatYenJa } from '@/lib/equity/format';
import { CAP_BASES, optionLabel } from '@/lib/equity/types';

const BASIS_PILL: Record<ConversionDetail['basis'], { label: string; className: string }> = {
  cap: { label: '評価上限額で転換', className: 'gt-pill gt-pill-sm gt-pill-accent' },
  discount: { label: 'ディスカウントで転換', className: 'gt-pill gt-pill-sm gt-pill-info' },
  undetermined: { label: '未確定', className: 'gt-pill gt-pill-sm gt-pill-warn' },
};

const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <dt className="text-[12px] text-text-muted">{label}</dt>
    <dd className="m-0 mt-0.5 text-[13.5px] font-medium text-text-heading tabular-nums">{value}</dd>
  </div>
);

export const ConversionDetails = ({
  conversions,
  conversionBaseShares,
  hasScenario,
}: {
  conversions: ConversionDetail[];
  /** 転換価額の計算に使った完全希釈化後株式数 */
  conversionBaseShares: number;
  /** 次回調達の単価を仮定しているか（していなければディスカウント基準の価額は出せない） */
  hasScenario: boolean;
}) => {
  if (conversions.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] leading-relaxed text-text-muted m-0">
        転換価額と株式数は<strong className="font-semibold text-text-main">概算</strong>
        です。評価上限額 ÷ 完全希釈化後株式数（{formatNumber(conversionBaseShares)}株を基準。ポストマネー基準の回次は転換後の株式も加算）と、次回調達の
        1 株あたり払込金額 × (1 − ディスカウント) の低いほうを使い、すべての回次が同時に転換する前提で計算しています。「完全希釈化後株式数」に何を含めるかなど、実際の転換は
        <strong className="font-semibold text-text-main">契約書の定義が優先</strong>します。
        {!hasScenario && ' 次回調達の単価を仮定していないため、評価上限額だけで計算しています（下の「次回ラウンドのシミュレーション」で単価を入れると、ディスカウントも比べます）。'}
      </p>
      {conversions.map((detail) => {
        const pill = BASIS_PILL[detail.basis];
        return (
          <div key={detail.roundId} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-semibold text-text-heading m-0">{detail.roundName}</h3>
              <span className={pill.className}>{pill.label}</span>
            </div>
            {/* 6 列に並べるのは、ラベル（「ディスカウントによる価額」など）が 1 行に収まる広い画面だけ */}
            <dl className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-x-4 gap-y-3 mt-3 mb-0">
              <Fact label="評価上限額" value={detail.valuationCap != null ? formatYenJa(detail.valuationCap) : 'なし'} />
              <Fact label="評価上限額の基準" value={optionLabel(CAP_BASES, detail.capBasis)} />
              <Fact label="ディスカウント" value={detail.discountRate > 0 ? formatRatio(detail.discountRate, 1) : 'なし'} />
              <Fact label="評価上限額による価額" value={detail.capPrice != null ? formatYen(detail.capPrice) : '—'} />
              <Fact label="ディスカウントによる価額" value={detail.discountPrice != null ? formatYen(detail.discountPrice) : '—'} />
              <Fact label="転換価額（概算）" value={detail.conversionPrice > 0 ? formatYen(detail.conversionPrice) : '未確定'} />
            </dl>
            {detail.basis === 'undetermined' && (
              <p className="text-[12.5px] text-text-muted mt-3 mb-0">
                評価上限額が無く、次回調達の単価も仮定していないため、転換価額を決められません。シミュレーションで単価を入れると計算します。
              </p>
            )}
            <div className="gt-table-scroll mt-2">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th scope="col">投資家</th>
                    <th scope="col" className="gt-num">投資額</th>
                    <th scope="col" className="gt-num">転換後の株式数（概算）</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.investments.map((investment) => (
                    <tr key={investment.investmentId}>
                      <td>
                        <span className="block w-max max-w-[14.5em] whitespace-normal">{investment.stakeholderName}</span>
                      </td>
                      <td className="gt-num">{formatYenJa(investment.amount)}</td>
                      <td className="gt-num">{detail.conversionPrice > 0 ? formatNumber(investment.shares) : '未確定'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td>合計</td>
                    <td className="gt-num">{formatYenJa(detail.totalAmount)}</td>
                    <td className="gt-num">{detail.conversionPrice > 0 ? formatNumber(detail.totalShares) : '未確定'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};
