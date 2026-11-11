'use client';

// 新株予約権原簿（会社法249条）。新株予約権者ごとに、氏名・住所、新株予約権の内容と数、取得した日を並べる。
import React, { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/resource/parts';
import { Button } from '@/components/ui/button';
import { formatDateJa, formatNumber } from '@/lib/equity/format';
import type { EquitySnapshot } from '@/lib/equity/types';
import { downloadBlob } from '@/lib/files/download';
import { errorMessage } from '@/lib/resources/client';
import { buildWarrantRegister, type WarrantRegisterRow } from '../services/optionSummary';
import { buildWarrantRegisterWorkbook } from '../services/warrantRegisterExcel';
import { recordActivity } from '@/lib/audit/activityClient';

interface HolderGroup {
  stakeholderId: string;
  holderName: string;
  address: string;
  rows: WarrantRegisterRow[];
}

const groupByHolder = (rows: readonly WarrantRegisterRow[]): HolderGroup[] => {
  const groups = new Map<string, HolderGroup>();
  for (const row of rows) {
    const group = groups.get(row.stakeholderId) ?? { stakeholderId: row.stakeholderId, holderName: row.holderName, address: row.address, rows: [] };
    group.rows.push(row);
    groups.set(row.stakeholderId, group);
  }
  return Array.from(groups.values());
};

/**
 * 新株予約権の内容。「／」で区切った項目ごとにひとかたまりにし、区切りの位置でだけ折り返す
 * （行使期間の日付や金額の途中で行が切れないように）。
 */
const ContentTerms = ({ content }: { content: string }) => {
  const terms = content.split('／');
  return (
    <>
      {terms.map((term, index) => (
        <span key={`${index}:${term}`} className="inline-block whitespace-nowrap">
          {term}
          {index < terms.length - 1 && '／'}
        </span>
      ))}
    </>
  );
};

export const WarrantRegister = ({ snapshot, today, companyName }: { snapshot: EquitySnapshot; today: string; companyName: string }) => {
  const rows = useMemo(() => buildWarrantRegister(snapshot, today), [snapshot, today]);
  const groups = useMemo(() => groupByHolder(rows), [rows]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const fileName = `新株予約権原簿_${today.replaceAll('-', '')}.xlsx`;
      // 出力の前に監査ログに残す（残せなかったら出力しない）
      await recordActivity('export.warrant_register', { asOf: today, rows: rows.length, fileName });
      const blob = await buildWarrantRegisterWorkbook(rows, { companyName, asOf: today });
      downloadBlob(blob, fileName);
    } catch (caught) {
      setExportError(errorMessage(caught, 'Excel の出力に失敗しました'));
    } finally {
      setIsExporting(false);
    }
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        title="新株予約権者がいません"
        description="新株予約権を割り当てると、新株予約権者の氏名・住所、新株予約権の内容と数、取得した日がここに並びます。"
      />
    );
  }

  return (
    <section className="gt-card gt-card-table" aria-label="新株予約権原簿">
      <div className="gt-card-head">
        <div>
          <h2 className="gt-card-title m-0">新株予約権原簿</h2>
          <div className="gt-card-sub">
            {formatDateJa(today)} 現在・新株予約権者 {groups.length} 名。記載事項は、氏名又は名称及び住所、新株予約権の内容及び数、取得した日です（会社法249条）。
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={exportExcel} disabled={isExporting}>
          {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
          Excel で出力
        </Button>
      </div>
      {exportError && (
        <p role="alert" className="text-[13px] text-danger mt-2 mb-0">
          {exportError}
        </p>
      )}

      <div className="gt-table-scroll mt-2">
        <table className="gt-table">
          <thead>
            <tr>
              <th>氏名又は名称・住所</th>
              <th>回次・新株予約権の内容</th>
              <th className="gt-num">数（個）</th>
              <th>取得した日</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) =>
              group.rows.map((row, index) => (
                <tr key={row.key}>
                  {index === 0 && (
                    // 「○○1号投資事業有限責任組合」程度の名称が 1 行に入る幅（16 文字ぶん）を保つ
                    <td rowSpan={group.rows.length} className="gt-wrap min-w-[16em] align-top">
                      <span className="block font-medium text-text-heading text-balance">{group.holderName}</span>
                      <span className="block text-[12px] text-text-muted leading-relaxed">
                        {group.address || <span className="text-warning">住所が未入力です</span>}
                      </span>
                    </td>
                  )}
                  {/* 同じ人の 2 行目以降は氏名のセルが無く、このセルが行の先頭になる。左の余白を 1 行目と揃える */}
                  <td className={index === 0 ? 'gt-wrap-lg' : 'gt-wrap-lg pl-3'}>
                    <span className="block font-medium text-text-heading">{row.planName}</span>
                    <span className="block text-[12.5px] leading-relaxed text-text-body">
                      <ContentTerms content={row.content} />
                    </span>
                  </td>
                  <td className="gt-num">{row.units == null ? '—' : formatNumber(row.units)}</td>
                  <td>{formatDateJa(row.acquiredOn)}</td>
                  <td className="gt-wrap text-[12.5px] text-text-muted">{row.note}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-3">
        残数のある割当と、未転換の転換型（J-KISS 型新株予約権など）を載せています。行使・失効で残数が 0 になった割当は載せていません。
        原簿は本店に備え置き、株主と債権者は理由を明らかにして閲覧・謄写を請求できます（会社法252条）。
      </p>
    </section>
  );
};
