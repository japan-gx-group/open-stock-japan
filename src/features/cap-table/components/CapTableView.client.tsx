'use client';

// 資本政策表の画面。基準日・未割当枠の扱いを切り替えて表を出し、転換の内訳・次回ラウンドの試算・優先分配の試算・Excel 出力を付ける。

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/layout/PageHeading';
import { EmptyState, ErrorBlock, LoadingBlock, StatGrid, StatTile } from '@/components/resource/parts';
import { useCompany } from '@/hooks/useCompany';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEquitySnapshot } from '@/hooks/useEquitySnapshot';
import { buildCapTable, type CapTableOptions } from '@/lib/equity/capTable';
import { formatDateJa, formatNumber, formatYenJa, isValidDateText, todayInTokyo } from '@/lib/equity/format';
import { downloadBlob } from '@/lib/files/download';
import { errorMessage } from '@/lib/resources/client';
import { canEdit } from '@/types/role';
import { capTableSheet } from '../services/capTableGrid';
import { sheetToXlsxBlob } from '../services/xlsx';
import { recordActivity } from '@/lib/audit/activityClient';
import { CapTableGrid } from './CapTableGrid';
import { ConversionDetails } from './ConversionDetails';
import { ExitWaterfall } from './ExitWaterfall.client';
import { RoundSimulator } from './RoundSimulator.client';

const Section = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <section className="gt-card">
    <div className="gt-card-head">
      <div>
        <h2 className="gt-card-title m-0">{title}</h2>
        {sub && <p className="gt-card-sub mb-0">{sub}</p>}
      </div>
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

export const CapTableView = () => {
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  const snapshotState = useEquitySnapshot();
  const company = useCompany();
  const [asOfInput, setAsOfInput] = useState('');
  const [includePool, setIncludePool] = useState(true);
  const [conversionBaseIncludesPool, setConversionBaseIncludesPool] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const asOf = isValidDateText(asOfInput) ? asOfInput : null;
  const options = useMemo<Omit<CapTableOptions, 'scenario'>>(
    () => ({ asOf, includeUnallocatedPool: includePool, conversionBaseIncludesPool }),
    [asOf, includePool, conversionBaseIncludesPool],
  );
  const snapshot = snapshotState.data;
  const table = useMemo(() => (snapshot ? buildCapTable(snapshot, options) : null), [snapshot, options]);

  const companyName = typeof company.data?.name === 'string' ? company.data.name : '';
  const asOfLabel = asOf ? `${formatDateJa(asOf)} 現在` : `すべての異動を反映（${formatDateJa(todayInTokyo())} 出力）`;

  const exportXlsx = async () => {
    if (!table || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const fileName = `資本政策表_${asOf ?? todayInTokyo()}.xlsx`;
      // 出力の前に監査ログに残す（残せなかったら出力しない）
      await recordActivity('export.cap_table', { asOf: asOf ?? null, rows: table.rows.length, fileName });
      const blob = await sheetToXlsxBlob(capTableSheet(table, { companyName, asOfLabel }));
      downloadBlob(blob, fileName);
    } catch (caught) {
      setExportError(errorMessage(caught, 'Excel の出力に失敗しました'));
    } finally {
      setIsExporting(false);
    }
  };

  const heading = (
    <PageHeading
      title="資本政策表"
      description="株主・新株予約権者・転換型証券の投資家ごとの持株と、完全希釈化後の比率を確認します。"
      actions={
        table && table.rows.length > 0 ? (
          <Button type="button" variant="outline" onClick={exportXlsx} disabled={isExporting}>
            {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
            Excel に出力
          </Button>
        ) : undefined
      }
    />
  );

  if (snapshotState.isLoading && !snapshot) {
    return (
      <>
        {heading}
        <LoadingBlock />
      </>
    );
  }
  if (!snapshot || !table) {
    return (
      <>
        {heading}
        <ErrorBlock message={snapshotState.error ?? 'データの取得に失敗しました'} onRetry={() => void snapshotState.reload()} />
      </>
    );
  }

  const hasLedger =
    snapshot.shareTransactions.length > 0 || snapshot.optionGrants.length > 0 || snapshot.convertibleInvestments.length > 0;
  if (!hasLedger) {
    return (
      <>
        {heading}
        <EmptyState
          title="株式の記録がまだありません"
          description="株主名簿で株主と株式の異動（設立時の発行など）を登録すると、ここに資本政策表が表示されます。"
          action={
            <Link href="/shareholders" className="gt-btn-primary">
              株主名簿を開く
            </Link>
          }
        />
      </>
    );
  }

  const { totals } = table;
  return (
    <>
      {heading}
      <div className="flex flex-col gap-4">
        {snapshotState.error && <ErrorBlock message={snapshotState.error} onRetry={() => void snapshotState.reload()} />}
        {exportError && <ErrorBlock message={exportError} />}

        <StatGrid>
          <StatTile label="発行済株式総数" value={`${formatNumber(totals.issuedShares)}株`} sub={`株主 ${formatNumber(totals.shareholderCount)}名`} />
          <StatTile
            label="完全希釈化後株式数"
            value={`${formatNumber(totals.fullyDilutedShares)}株`}
            sub={includePool ? '未割当の SO 枠を含む' : '未割当の SO 枠を含まない'}
          />
          <StatTile
            label="未行使の新株予約権"
            value={`${formatNumber(totals.optionShares)}株`}
            sub={`未割当の枠 ${formatNumber(totals.unallocatedPoolShares)}株`}
          />
          <StatTile
            label="未転換の転換型証券"
            value={formatYenJa(totals.convertibleAmount)}
            sub={totals.convertibleAmount > 0 ? `転換すると約 ${formatNumber(totals.convertibleShares)}株（概算）` : 'なし'}
          />
        </StatGrid>

        <section className="gt-card gt-card-table">
          <div className="gt-card-head">
            <div>
              <h2 className="gt-card-title m-0">持株と完全希釈化後の比率</h2>
              <p className="gt-card-sub mb-0">{asOf ? `${formatDateJa(asOf)} までの異動で集計` : 'すべての異動を反映'}</p>
            </div>
          </div>
          <div className="gt-filter-bar">
            <div className="gt-filter-field">
              <label htmlFor="cap-table-as-of" className="gt-field-label">
                基準日
              </label>
              <input
                id="cap-table-as-of"
                type="date"
                className="gt-field"
                value={asOfInput}
                onChange={(event) => setAsOfInput(event.target.value)}
              />
            </div>
            {asOfInput !== '' && (
              <button type="button" className="gt-btn" onClick={() => setAsOfInput('')}>
                すべての異動に戻す
              </button>
            )}
            <div className="flex flex-col gap-2 text-[13px] text-text-main" style={{ paddingBottom: '2px' }}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includePool} onChange={(event) => setIncludePool(event.target.checked)} />
                未割当の SO 枠を完全希釈化後株式数に含める
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conversionBaseIncludesPool}
                  onChange={(event) => setConversionBaseIncludesPool(event.target.checked)}
                />
                <span>
                  転換価額の計算の基準にも未割当の SO 枠を含める
                  <span className="text-text-muted">（詳細設定。J-KISS 等の契約書の「完全希釈化後株式数」の定義に合わせます）</span>
                </span>
              </label>
            </div>
          </div>
          <div className="mt-2">
            <CapTableGrid table={table} caption="資本政策表" />
          </div>
          <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-3">
            種類株式は転換比率で普通株式に換算して完全希釈化後の株式数に入れています。議決権比率は 1 株 1 議決権として計算しており、単元株・自己株式・相互保有株式は考慮していません。転換型の株式数は概算です。
          </p>
        </section>

        {table.conversions.length > 0 && (
          <Section title="転換型証券の転換の内訳（概算）" sub="J-KISS 型新株予約権などの、回次ごとの転換価額と交付する株式数">
            <ConversionDetails conversions={table.conversions} conversionBaseShares={totals.conversionBaseShares} hasScenario={false} />
          </Section>
        )}

        <Section title="次回ラウンドのシミュレーション" sub="保存されない試算です">
          <RoundSimulator
            snapshot={snapshot}
            baseTable={table}
            options={options}
            canEdit={editable}
            onRoundSaved={() => void snapshotState.reload()}
          />
        </Section>

        <Section title="優先分配の試算" sub="売却額を株式の種類ごとにどう分けるか">
          <ExitWaterfall table={table} shareClasses={snapshot.shareClasses} />
        </Section>
      </div>
    </>
  );
};
