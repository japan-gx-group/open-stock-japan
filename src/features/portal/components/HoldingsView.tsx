// 自分の保有状況（株式・新株予約権・転換型）。渡されるのは本人の分と発行済株式総数だけ。
import { formatDateJa, formatRatio, formatShares, formatUnits, formatYen, formatYenJa } from '@/lib/equity/format';
import { CONVERTIBLE_INSTRUMENT_TYPES, CONVERTIBLE_STATUSES, OPTION_PLAN_TYPES, optionLabel } from '@/lib/equity/types';
import type { PortalConvertible, PortalHoldings, PortalOptionGrant, PortalShareHolding } from '../services/visibility';
import { Empty, Section } from './parts';

export const HoldingsUnlinked = ({ isPreview }: { isPreview: boolean }) => (
  <Empty>
    {isPreview
      ? '社内ユーザーのプレビューでは保有状況は表示されません。株主本人がログインすると、その人の株式・新株予約権・転換型の投資だけがここに表示されます。'
      : 'このアカウントは株主名簿の記録にまだ紐づいていません。お手数ですが、会社の担当者にお問い合わせください。'}
  </Empty>
);

export const HoldingsSummary = ({ holdings }: { holdings: PortalHoldings }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
    {[
      { label: '保有株式数', value: formatShares(holdings.ownShares) },
      { label: '発行済株式総数に対する割合', value: holdings.totalIssuedShares > 0 ? formatRatio(holdings.ownRatio) : '—' },
      { label: '新株予約権（残り）', value: formatUnits(holdings.optionGrants.reduce((total, grant) => total + grant.remainingUnits, 0)) },
      {
        label: '転換型への投資（未転換）',
        value: formatYenJa(holdings.convertibles.filter((item) => item.status === 'outstanding').reduce((total, item) => total + item.amount, 0)),
      },
    ].map((tile) => (
      <div key={tile.label} className="rounded-md border border-border bg-bg-subtle px-3 py-3">
        <div className="text-[11.5px] text-text-muted">{tile.label}</div>
        <div className="text-[18px] font-semibold text-text-heading tabular-nums whitespace-nowrap mt-1">{tile.value}</div>
      </div>
    ))}
  </div>
);

const PERIOD_STATE_LABEL: Record<PortalOptionGrant['exercisePeriodState'], { label: string; tone: string }> = {
  unset: { label: '行使期間 未設定', tone: 'gt-pill-neutral' },
  before: { label: '行使期間の前', tone: 'gt-pill-info' },
  open: { label: '行使期間中', tone: 'gt-pill-good' },
  closed: { label: '行使期間 終了', tone: 'gt-pill-neutral' },
};

/** 取得日（複数回に分けて取得したときは、最初〜最後）。日付は途中で割らず、「〜」のあとでだけ折り返す。suffix は最後の日付に続けて出す */
const AcquiredOn = ({ row, suffix = '' }: { row: PortalShareHolding; suffix?: string }) =>
  row.firstAcquiredOn && row.lastAcquiredOn && row.firstAcquiredOn !== row.lastAcquiredOn ? (
    <>
      <span className="whitespace-nowrap">{formatDateJa(row.firstAcquiredOn)}〜</span>
      <wbr />
      <span className="whitespace-nowrap">
        {formatDateJa(row.lastAcquiredOn)}
        {suffix}
      </span>
    </>
  ) : (
    <span className="whitespace-nowrap">
      {formatDateJa(row.firstAcquiredOn)}
      {suffix}
    </span>
  );

const convertibleStatus = (item: PortalConvertible): string => optionLabel(CONVERTIBLE_STATUSES, item.status);

/** 転換済みのときの補足（転換後の株式数・転換日） */
const convertedNote = (item: PortalConvertible): string | null =>
  item.convertedShares != null ? `${formatShares(item.convertedShares)}・${formatDateJa(item.convertedOn)}` : null;

/** 転換型の投資 1 件の条件（スマートフォン用のカードで並べる項目。広い画面では表の列になる） */
const convertibleTerms = (item: PortalConvertible): [string, string][] => [
  ['投資額', formatYenJa(item.amount)],
  ['払込日', formatDateJa(item.investmentDate)],
  ['評価上限額', item.valuationCap == null ? 'なし' : formatYenJa(item.valuationCap)],
  ['ディスカウント', item.discountRate > 0 ? formatRatio(item.discountRate, 0) : 'なし'],
  ['転換期限', formatDateJa(item.conversionDeadline)],
];

export const HoldingsDetail = ({ holdings }: { holdings: PortalHoldings }) => (
  <div className="flex flex-col gap-4">
    <Section title="株式">
      {holdings.shares.length === 0 ? (
        <Empty>現在、保有している株式はありません。</Empty>
      ) : (
        <div className="gt-table-scroll">
          <table className="gt-table">
            <thead>
              <tr>
                <th>株式の種類</th>
                <th className="gt-num">株式数</th>
                <th className="gt-num" title="発行済株式総数に対する割合">
                  持株比率
                </th>
                {/* スマートフォンでは取得日の列を出さず、株式の種類の下の行に入れる（表が横にはみ出さないように） */}
                <th className="hidden sm:table-cell">取得日</th>
              </tr>
            </thead>
            <tbody>
              {holdings.shares.map((row) => (
                <tr key={row.shareClassName}>
                  <td className="gt-wrap-sm">
                    <div className="whitespace-nowrap">{row.shareClassName}</div>
                    <div className="text-[11.5px] text-text-muted sm:hidden">
                      <AcquiredOn row={row} suffix=" 取得" />
                    </div>
                  </td>
                  <td className="gt-num">{formatShares(row.shares)}</td>
                  <td className="gt-num">{formatRatio(row.ratio)}</td>
                  <td className="hidden sm:table-cell">
                    <AcquiredOn row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-0">
        発行済株式総数: <span className="whitespace-nowrap">{formatShares(holdings.totalIssuedShares)}</span>（
        <span className="whitespace-nowrap">{formatDateJa(holdings.asOf)}</span> 現在）。持株比率は、発行済株式総数に対する割合です（潜在株式を含まない単純な比率）。
      </p>
    </Section>

    <Section title="新株予約権（ストックオプション）">
      {holdings.optionGrants.length === 0 ? (
        <Empty>割り当てられた新株予約権はありません。</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {holdings.optionGrants.map((grant, index) => {
            const state = PERIOD_STATE_LABEL[grant.exercisePeriodState];
            return (
              <div key={index} className="rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-text-heading">{grant.planName}</span>
                  <span className="gt-pill gt-pill-sm gt-pill-neutral">{optionLabel(OPTION_PLAN_TYPES, grant.planType)}</span>
                  <span className={`gt-pill gt-pill-sm ${state.tone}`}>{state.label}</span>
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 mb-0 text-[13px]">
                  {[
                    ['割当個数', formatUnits(grant.units)],
                    ['権利確定済み', formatUnits(grant.vestedUnits)],
                    ['行使済み', formatUnits(grant.exercisedUnits)],
                    ['失効', formatUnits(grant.forfeitedUnits)],
                    ['残り', formatUnits(grant.remainingUnits)],
                    ['いま行使できる個数', formatUnits(grant.exercisableUnits)],
                    ['行使価額（1 株あたり）', formatYen(grant.exercisePrice)],
                    ['1 個あたりの株式数', formatShares(grant.sharesPerUnit)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11.5px] text-text-muted">{label}</dt>
                      <dd className="m-0 text-text-heading tabular-nums whitespace-nowrap">{value}</dd>
                    </div>
                  ))}
                </dl>
                {/* 「項目: 日付」のかたまりは途中で割らず、かたまりの切れ目（／のあと）で折り返す */}
                <p className="flex flex-wrap text-[12px] leading-relaxed text-text-muted mt-3 mb-0">
                  {[
                    `割当日: ${formatDateJa(grant.grantedOn)}`,
                    `行使期間: ${formatDateJa(grant.exercisePeriodStart)}〜${formatDateJa(grant.exercisePeriodEnd)}`,
                    grant.cliffOn ? `クリフ明け: ${formatDateJa(grant.cliffOn)}` : null,
                    grant.unvestedUnits > 0 && grant.fullyVestedOn ? `全量の権利確定: ${formatDateJa(grant.fullyVestedOn)}` : null,
                  ]
                    .filter((part): part is string => part != null)
                    .map((part, partIndex, parts) => (
                      <span key={part} className="whitespace-nowrap">
                        {part}
                        {partIndex < parts.length - 1 && '／'}
                      </span>
                    ))}
                </p>
                {grant.exerciseConditions && (
                  <p className="text-[12px] leading-relaxed text-text-body mt-2 mb-0 whitespace-pre-wrap">行使の条件: {grant.exerciseConditions}</p>
                )}
              </div>
            );
          })}
          <p className="text-[12px] leading-relaxed text-text-muted m-0">
            権利確定（ベスティング）と行使できる個数は、登録されている条件からの計算上の目安です。実際の行使の可否は、割当契約書・発行要項の定めによります。
          </p>
        </div>
      )}
    </Section>

    <Section title="転換型の投資（J-KISS など）">
      {holdings.convertibles.length === 0 ? (
        <Empty>転換型の投資はありません。</Empty>
      ) : (
        <>
          {/* 列が多いので、表は広い画面（lg 以上）だけ。それより狭い画面では、新株予約権と同じ形のカードで 1 件ずつ出す */}
          <div className="flex flex-col gap-3 lg:hidden">
            {holdings.convertibles.map((item, index) => {
              const note = convertedNote(item);
              return (
                <div key={index} className="rounded-md border border-border px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-text-heading">{item.roundName}</span>
                    <span className="gt-pill gt-pill-sm gt-pill-neutral">{optionLabel(CONVERTIBLE_INSTRUMENT_TYPES, item.instrumentType)}</span>
                    <span className="gt-pill gt-pill-sm gt-pill-neutral">{convertibleStatus(item)}</span>
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-2 mt-3 mb-0 text-[13px]">
                    {convertibleTerms(item).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[11.5px] text-text-muted">{label}</dt>
                        <dd className="m-0 text-text-heading tabular-nums whitespace-nowrap">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {note && <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-0">転換後: {note}</p>}
                </div>
              );
            })}
          </div>
          <div className="gt-table-scroll hidden lg:block">
            <table className="gt-table">
              <thead>
                <tr>
                  <th>名称・種類</th>
                  <th className="gt-num">投資額</th>
                  <th>払込日</th>
                  <th className="gt-num">評価上限額</th>
                  <th className="gt-num">ディスカウント</th>
                  <th>転換期限</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {holdings.convertibles.map((item, index) => {
                  const [amount, investmentDate, valuationCap, discount, deadline] = convertibleTerms(item).map(([, value]) => value);
                  const note = convertedNote(item);
                  return (
                    <tr key={index}>
                      {/* 名称が長いときは、表を横にはみ出させずにこの列の中で折り返す */}
                      <td className="gt-wrap">
                        {item.roundName}
                        <div className="text-[11.5px] text-text-muted whitespace-nowrap">{optionLabel(CONVERTIBLE_INSTRUMENT_TYPES, item.instrumentType)}</div>
                      </td>
                      <td className="gt-num">{amount}</td>
                      <td>{investmentDate}</td>
                      <td className="gt-num">{valuationCap}</td>
                      <td className="gt-num">{discount}</td>
                      <td>{deadline}</td>
                      <td>
                        {convertibleStatus(item)}
                        {note && <div className="text-[11.5px] text-text-muted">{note}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  </div>
);
