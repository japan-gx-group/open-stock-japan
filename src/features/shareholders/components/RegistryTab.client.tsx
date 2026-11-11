'use client';

// 株主名簿（会社法121条）。基準日を指定すると、その日までの異動で名簿を作る。

import React, { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sheetToXlsxBlob } from '@/features/cap-table/services/xlsx';
import { recordActivity } from '@/lib/audit/activityClient';
import { formatDateJa, formatNumber, formatRatio, isValidDateText, todayInTokyo } from '@/lib/equity/format';
import { buildRegistry } from '@/lib/equity/ledger';
import type { EquitySnapshot } from '@/lib/equity/types';
import { downloadBlob } from '@/lib/files/download';
import { errorMessage } from '@/lib/resources/client';
import { registrySheet } from '../services/ledgerViews';

export const RegistryTab = ({ snapshot, companyName }: { snapshot: EquitySnapshot; companyName: string }) => {
  const [recordDateInput, setRecordDateInput] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const recordDate = isValidDateText(recordDateInput) ? recordDateInput : null;
  const registry = useMemo(() => buildRegistry(snapshot, recordDate), [snapshot, recordDate]);
  const multipleClasses = new Set(registry.rows.map((row) => row.shareClassId)).size > 1;

  const exportXlsx = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const date = recordDate ?? todayInTokyo();
      const fileName = `株主名簿（${date} 現在）.xlsx`;
      // 出力の前に監査ログに残す（残せなかったら出力しない）。株主名簿は氏名・住所を含む
      await recordActivity('export.shareholder_registry', { asOf: date, rows: registry.rows.length, fileName });
      const blob = await sheetToXlsxBlob(registrySheet(registry, companyName, date));
      downloadBlob(blob, fileName);
    } catch (caught) {
      setExportError(errorMessage(caught, 'Excel の出力に失敗しました'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <div className="gt-filter-bar" style={{ marginTop: 0 }}>
        <div className="gt-filter-field">
          <label htmlFor="registry-record-date" className="gt-field-label">
            基準日
          </label>
          <input
            id="registry-record-date"
            type="date"
            className="gt-field"
            value={recordDateInput}
            onChange={(event) => setRecordDateInput(event.target.value)}
          />
        </div>
        {recordDateInput !== '' && (
          <button type="button" className="gt-btn" onClick={() => setRecordDateInput('')}>
            最新の状態に戻す
          </button>
        )}
        <div className="text-[13px] text-text-body" style={{ paddingBottom: '9px' }}>
          {recordDate ? `${formatDateJa(recordDate)} 現在` : `最新（${formatDateJa(todayInTokyo())} 現在）`}： 株主{' '}
          <strong className="tabular-nums">{formatNumber(registry.shareholderCount)}</strong> 名 ／ 発行済株式総数{' '}
          <strong className="tabular-nums">{formatNumber(registry.totalShares)}</strong> 株
        </div>
        <div className="ml-auto">
          <Button type="button" variant="outline" onClick={exportXlsx} disabled={isExporting || registry.rows.length === 0}>
            {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
            Excel に出力
          </Button>
        </div>
      </div>
      {exportError && (
        <p role="alert" className="text-[13px] text-danger mt-3 mb-0">
          {exportError}
        </p>
      )}

      <div className="gt-table-scroll mt-2">
        <table className="gt-table">
          <thead>
            <tr>
              <th scope="col">氏名又は名称</th>
              <th scope="col">住所</th>
              <th scope="col">株式の種類</th>
              <th scope="col" className="gt-num">株式数</th>
              <th scope="col">株式を取得した日</th>
              {multipleClasses && <th scope="col" className="gt-num">種類内の割合</th>}
              <th scope="col" className="gt-num" title="発行済株式総数に対する割合">
                持株比率
              </th>
            </tr>
          </thead>
          <tbody>
            {registry.rows.length === 0 && (
              <tr>
                <td colSpan={multipleClasses ? 7 : 6} className="gt-table-empty whitespace-normal">
                  {recordDate
                    ? 'この基準日の時点で株式を持つ株主がいません。'
                    : '株主がまだいません。「権利者」で株主を登録し、「株式の異動」で設立時の発行などを登録してください。'}
                </td>
              </tr>
            )}
            {registry.rows.map((row) => (
              <tr key={`${row.stakeholderId}:${row.shareClassId}`}>
                {/* 氏名は 14 文字まで 1 行に収まる幅（14 文字 ＋ セルの左右の余白）を確保し、それより長い名称だけ折り返す。フリガナは列を広げない */}
                <td className="gt-wrap min-w-[calc(14em+18px)] font-medium">
                  {row.name}
                  {row.nameKana && (
                    <span className="gt-cell-clip text-[11.5px] font-normal text-text-muted" title={row.nameKana}>
                      {row.nameKana}
                    </span>
                  )}
                </td>
                <td className="gt-wrap">
                  {row.address.trim() ? (
                    <>
                      {row.postalCode && <span className="whitespace-nowrap text-text-muted">〒{row.postalCode} </span>}
                      {row.address}
                    </>
                  ) : (
                    <span className="gt-pill gt-pill-sm gt-pill-warn">住所が未入力</span>
                  )}
                </td>
                <td>{row.shareClassName}</td>
                <td className="gt-num">{formatNumber(row.shares)}</td>
                <td>
                  {formatDateJa(row.firstAcquiredOn)}
                  {row.lastAcquiredOn && row.lastAcquiredOn !== row.firstAcquiredOn && (
                    <div className="text-[11.5px] text-text-muted">最後の取得 {formatDateJa(row.lastAcquiredOn)}</div>
                  )}
                </td>
                {multipleClasses && <td className="gt-num">{formatRatio(row.classRatio)}</td>}
                <td className="gt-num">{formatRatio(row.totalRatio)}</td>
              </tr>
            ))}
          </tbody>
          {registry.rows.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={3}>合計</td>
                <td className="gt-num">{formatNumber(registry.totalShares)}</td>
                <td />
                {multipleClasses && <td />}
                <td className="gt-num">{formatRatio(1)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-3">
        株主名簿には、株主の氏名又は名称及び住所、株主の有する株式の数（種類株式発行会社では種類及び種類ごとの数）、株式を取得した日を記載します（会社法121条）。
        株主名簿は本店に備え置き、株主・債権者は、営業時間内に請求の理由を明らかにして閲覧・謄写を請求できます（会社法125条）。
        「株式を取得した日」は、現在の持株につながる取得のうち最初の日を表示しています。
      </p>
    </div>
  );
};
