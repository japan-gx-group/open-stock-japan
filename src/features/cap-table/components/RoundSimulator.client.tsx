'use client';

// 次回ラウンドのシミュレーション。入力はこの画面の中だけで使い、台帳には保存しない。
// 「このシナリオをラウンドとして登録」で、計画中の資金調達ラウンドとして登録するフォームを開く。

import React, { useMemo, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { StatGrid, StatTile } from '@/components/resource/parts';
import {
  buildCapTable,
  postMoneyValuation,
  pricePerShareFromPreMoney,
  type CapTable,
  type CapTableOptions,
  type PreMoneyBasis,
} from '@/lib/equity/capTable';
import { formatNumber, formatRatio, formatYen, formatYenJa, parseNumberText } from '@/lib/equity/format';
import type { EquitySnapshot } from '@/lib/equity/types';
import { dilutionRows, rowKindLabel } from '../services/capTableGrid';
import { CapTableGrid } from './CapTableGrid';
import { ConversionDetails } from './ConversionDetails';

type PriceMode = 'pre_money' | 'price';

const NumberField = ({
  id,
  label,
  value,
  onChange,
  placeholder,
  unit,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  unit: 'yen' | 'shares';
  help?: string;
}) => {
  const parsed = parseNumberText(value);
  const invalid = value.trim() !== '' && (parsed == null || parsed < 0);
  return (
    <div>
      <label htmlFor={id} className="gt-field-label">
        {label}
      </label>
      <input
        id={id}
        className="gt-field"
        style={{ textAlign: 'right' }}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className={`text-[12px] mt-1 mb-0 ${invalid ? 'text-danger' : 'text-text-muted'}`}>
        {invalid
          ? '数値で入力してください（例: 5億、1,000万）'
          : parsed != null && value.trim() !== ''
            ? `= ${unit === 'yen' ? formatYenJa(parsed) : `${formatNumber(parsed)}株`}`
            : (help ?? ' ')}
      </p>
    </div>
  );
};

const positive = (value: string): number | null => {
  const parsed = parseNumberText(value);
  return parsed != null && parsed > 0 ? parsed : null;
};

export const RoundSimulator = ({
  snapshot,
  baseTable,
  options,
  canEdit,
  onRoundSaved,
}: {
  snapshot: EquitySnapshot;
  /** シナリオなしの表（希薄化の比較の「前」） */
  baseTable: CapTable;
  options: Omit<CapTableOptions, 'scenario'>;
  canEdit: boolean;
  onRoundSaved: () => void;
}) => {
  const [mode, setMode] = useState<PriceMode>('pre_money');
  const [preMoneyText, setPreMoneyText] = useState('');
  const [basis, setBasis] = useState<PreMoneyBasis>('excluding_convertibles');
  const [priceText, setPriceText] = useState('');
  const [newMoneyText, setNewMoneyText] = useState('');
  const [investorName, setInvestorName] = useState('');
  const [poolText, setPoolText] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);

  const preMoney = positive(preMoneyText);
  const newMoney = positive(newMoneyText) ?? 0;
  const additionalPoolShares = Math.floor(positive(poolText) ?? 0);

  const pricePerShare = useMemo(
    () => (mode === 'price' ? positive(priceText) : preMoney != null ? pricePerShareFromPreMoney(snapshot, preMoney, basis, options) : null),
    [mode, priceText, preMoney, basis, snapshot, options],
  );

  const simulated = useMemo(
    () =>
      pricePerShare == null
        ? null
        : buildCapTable(snapshot, {
            ...options,
            scenario: { pricePerShare, newMoney, newInvestorName: investorName, additionalPoolShares },
          }),
    [snapshot, options, pricePerShare, newMoney, investorName, additionalPoolShares],
  );
  const postMoney = simulated ? postMoneyValuation(simulated) : null;
  const dilution = useMemo(() => (simulated ? dilutionRows(baseTable, simulated) : []), [baseTable, simulated]);

  const roundDefaults = useMemo(() => {
    const defaults: Record<string, string | boolean> = { status: 'planned' };
    if (pricePerShare != null) defaults.pricePerShare = String(pricePerShare);
    if (mode === 'pre_money' && preMoney != null) defaults.preMoneyValuation = Math.round(preMoney).toLocaleString('ja-JP');
    if (newMoney > 0) defaults.targetAmount = Math.round(newMoney).toLocaleString('ja-JP');
    return defaults;
  }, [pricePerShare, mode, preMoney, newMoney]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] leading-relaxed text-text-muted m-0">
        次回の資金調達の条件を入れると、1 株あたりの払込金額・ポストマネー評価額・既存の株主の希薄化を試算します。ここでの入力は保存されません。
      </p>

      <div className="gt-filter-bar" style={{ marginTop: 0, alignItems: 'flex-start' }}>
        <fieldset className="border-none p-0 m-0 w-full">
          <legend className="gt-field-label">単価の決め方</legend>
          <div className="flex flex-wrap gap-4 text-[13px] text-text-main">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="simulator-mode" checked={mode === 'pre_money'} onChange={() => setMode('pre_money')} />
              プレマネー評価額から計算する
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="simulator-mode" checked={mode === 'price'} onChange={() => setMode('price')} />
              1 株あたり払込金額を直接入れる
            </label>
          </div>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-3 w-full">
          {mode === 'pre_money' ? (
            <>
              <NumberField id="simulator-pre-money" label="プレマネー評価額" value={preMoneyText} onChange={setPreMoneyText} placeholder="5億" unit="yen" />
              <div>
                <label htmlFor="simulator-basis" className="gt-field-label">
                  プレマネーを割る株式数
                </label>
                <select
                  id="simulator-basis"
                  className="gt-field gt-field-select"
                  value={basis}
                  onChange={(event) => setBasis(event.target.value as PreMoneyBasis)}
                >
                  <option value="excluding_convertibles">発行済 ＋ 新株予約権（転換型を含めない）</option>
                  <option value="including_convertibles">発行済 ＋ 新株予約権 ＋ 転換型の転換株式</option>
                </select>
                <p className="text-[12px] text-text-muted mt-1 mb-0">
                  未割当の SO 枠は、上の「未割当の SO 枠を含める」に従います。追加する SO 枠は含めません。
                </p>
              </div>
            </>
          ) : (
            <NumberField id="simulator-price" label="1 株あたり払込金額" value={priceText} onChange={setPriceText} placeholder="30,000" unit="yen" />
          )}
          <NumberField id="simulator-new-money" label="調達額" value={newMoneyText} onChange={setNewMoneyText} placeholder="1億" unit="yen" />
          <div>
            <label htmlFor="simulator-investor" className="gt-field-label">
              新規投資家名
            </label>
            <input
              id="simulator-investor"
              className="gt-field"
              value={investorName}
              maxLength={100}
              placeholder="新規投資家（次回調達）"
              onChange={(event) => setInvestorName(event.target.value)}
            />
          </div>
          <NumberField
            id="simulator-pool"
            label="追加する SO 枠（株）"
            value={poolText}
            onChange={setPoolText}
            placeholder="0"
            unit="shares"
            help="未割当の枠として希薄化に含めます"
          />
        </div>
      </div>

      {!simulated || pricePerShare == null ? (
        <p className="gt-table-empty m-0">
          {mode === 'pre_money'
            ? preMoney != null
              ? '発行済みの株式が無いため、単価を計算できません。'
              : 'プレマネー評価額を入れると試算します。'
            : '1 株あたり払込金額を入れると試算します。'}
        </p>
      ) : (
        <>
          <StatGrid>
            <StatTile
              label="1 株あたり払込金額"
              value={formatYen(pricePerShare)}
              sub={mode === 'pre_money' ? 'プレマネー ÷ 株式数（円未満切り上げ）' : '入力値'}
            />
            <StatTile
              label="ポストマネー評価額"
              value={formatYenJa(postMoney)}
              sub={`完全希釈化後 ${formatNumber(simulated.totals.fullyDilutedShares)}株 × 単価`}
            />
            <StatTile
              label="新規に発行する株式"
              value={`${formatNumber(simulated.totals.newShares)}株`}
              sub={newMoney > 0 ? `調達額 ${formatYenJa(newMoney)} ÷ 単価（1 株未満切り捨て）` : '調達額が未入力です'}
            />
            <StatTile
              label="転換型の転換（概算）"
              value={simulated.totals.convertibleAmount > 0 ? `${formatNumber(simulated.totals.convertibleShares)}株` : '—'}
              sub={simulated.totals.convertibleAmount > 0 ? `未転換 ${formatYenJa(simulated.totals.convertibleAmount)}` : '未転換の転換型証券はありません'}
            />
          </StatGrid>

          <div>
            <h3 className="text-[14px] font-semibold text-text-heading m-0">既存の株主・権利者の希薄化（完全希釈化後の比率）</h3>
            <div className="gt-table-scroll mt-1">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th scope="col">株主・権利者</th>
                    <th scope="col" className="gt-num">調達前（株）</th>
                    <th scope="col" className="gt-num">調達後（株）</th>
                    <th scope="col" className="gt-num">調達前 → 調達後</th>
                    <th scope="col" className="gt-num">増減</th>
                  </tr>
                </thead>
                <tbody>
                  {dilution.map((row) => (
                    <tr key={row.stakeholderId}>
                      {/* 下の資本政策表と同じく、区分は氏名の下に添える（セルの文字は区分の大きさ・色にし、氏名だけ本文の大きさに戻す） */}
                      <td className="text-[11.5px] text-text-muted">
                        <span className="block w-max max-w-[14.5em] whitespace-normal text-[13.5px] font-medium text-text-heading">{row.name}</span>
                        {rowKindLabel(row.kind)}
                      </td>
                      <td className="gt-num">{formatNumber(row.beforeShares)}</td>
                      <td className="gt-num">{formatNumber(row.afterShares)}</td>
                      <td className="gt-num">
                        {formatRatio(row.beforeRatio)}
                        <ArrowRight size={12} className="inline mx-1.5 text-text-subtle" aria-label="から" />
                        {formatRatio(row.afterRatio)}
                      </td>
                      <td className={`gt-num ${row.change < 0 ? 'text-danger' : ''}`}>
                        {row.change > 0 ? '+' : ''}
                        {(row.change * 100).toFixed(2)}pt
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-text-muted mt-2 mb-0">
              調達前の比率は、上の資本政策表（次回調達の単価を仮定しない状態）の完全希釈化後比率です。転換型証券は、単価を入れるとディスカウントも比べるため株式数が変わることがあります。
            </p>
          </div>

          <div>
            <h3 className="text-[14px] font-semibold text-text-heading m-0">調達後の資本政策表（試算）</h3>
            <div className="mt-1">
              <CapTableGrid table={simulated} caption="調達後の資本政策表（試算）" />
            </div>
          </div>

          {simulated.conversions.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold text-text-heading mt-0 mb-2">この条件での転換の内訳（概算）</h3>
              <ConversionDetails conversions={simulated.conversions} conversionBaseShares={simulated.totals.conversionBaseShares} hasScenario />
            </div>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(true)}>
                <Plus />
                このシナリオをラウンドとして登録
              </Button>
              <span className="text-[12px] text-text-muted">
                状態を「計画中」にして、単価・プレマネー評価額・調達額を入れた登録フォームを開きます。株式の割当ては、クロージング後に「資金調達・種類株式」から登録します。
              </span>
            </div>
          )}
        </>
      )}

      <ResourceFormDialog
        resource="funding-rounds"
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        defaults={roundDefaults}
        title="シナリオを資金調達ラウンドとして登録"
        onSaved={onRoundSaved}
      />
    </div>
  );
};
