'use client';

// 株式分割・併合の記録。対象の種類を持つ全株主の増減の行を、サーバ（POST /api/equity/split）がまとめて作る。

import React, { useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { NoticeList } from '@/components/resource/parts';
import { formatDateJa, formatNumber, isValidDateText, parseNumberText, todayInTokyo } from '@/lib/equity/format';
import type { EquitySnapshot } from '@/lib/equity/types';
import { registrationDeadline } from '@/lib/legal/rules';
import { ApiError, apiFetch, errorMessage } from '@/lib/resources/client';
import { splitPreview } from '../services/ledgerViews';

interface SplitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  snapshot: EquitySnapshot;
  hasBoardOfDirectors: boolean;
  onSaved: () => void;
}

const SplitForm = ({ onClose, snapshot, hasBoardOfDirectors, onSaved }: SplitDialogProps) => {
  const sortedClasses = useMemo(() => [...snapshot.shareClasses].sort((a, b) => a.sortOrder - b.sortOrder), [snapshot.shareClasses]);
  const [shareClassId, setShareClassId] = useState(sortedClasses.length === 1 ? sortedClasses[0].id : '');
  const [date, setDate] = useState(todayInTokyo());
  const [ratioText, setRatioText] = useState('');
  const [notes, setNotes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  const parsedRatio = parseNumberText(ratioText);
  const ratio = parsedRatio != null && parsedRatio > 0 && parsedRatio !== 1 ? parsedRatio : null;
  const validDate = isValidDateText(date) ? date : null;
  const preview = useMemo(
    () => (shareClassId && ratio != null && validDate ? splitPreview(snapshot, shareClassId, ratio, validDate) : null),
    [snapshot, shareClassId, ratio, validDate],
  );
  const isConsolidation = ratio != null && ratio < 1;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      await apiFetch('/api/equity/split', {
        method: 'POST',
        body: JSON.stringify({ shareClassId, transactionDate: date, ratio: ratioText, notes }),
      });
      onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors);
      setFormError(errorMessage(caught, '株式分割の記録に失敗しました'));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <NoticeList
        items={[
          {
            level: 'info',
            message: (
              <>
                株式分割は{hasBoardOfDirectors ? '取締役会の決議' : '株主総会の普通決議（取締役会を置かない会社）'}
                （会社法183条）、株式併合は株主総会の特別決議（会社法180条）で決めます。発行済株式の総数が変わるため、変更の登記が必要です（会社法915条1項）。
                {validDate && ` この効力発生日の場合、登記の期限は ${formatDateJa(registrationDeadline(validDate))} です。`}
              </>
            ),
          },
          {
            level: 'warning',
            message:
              '新株予約権（ストックオプション・J-KISS 等）の行使価額と目的となる株式の数は、発行要項の調整条項に従って調整します。この記録では自動で変更されないため、「ストックオプション」「J-KISS・転換型」の画面で発行要項に沿って直してください。',
          },
        ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-4 mt-4">
        <div>
          <label htmlFor="split-class" className="gt-field-label">
            株式の種類<span className="text-danger"> *</span>
          </label>
          <select
            id="split-class"
            className="gt-field gt-field-select"
            value={shareClassId}
            disabled={isSaving}
            aria-invalid={Boolean(fieldErrors.shareClassId) || undefined}
            onChange={(event) => setShareClassId(event.target.value)}
          >
            <option value="">選択してください</option>
            {sortedClasses.map((shareClass) => (
              <option key={shareClass.id} value={shareClass.id}>
                {shareClass.name}
              </option>
            ))}
          </select>
          {fieldErrors.shareClassId && (
            <p role="alert" className="text-[12px] text-danger mt-1 mb-0">
              {fieldErrors.shareClassId}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="split-date" className="gt-field-label">
            効力発生日<span className="text-danger"> *</span>
          </label>
          <input
            id="split-date"
            type="date"
            className="gt-field"
            value={date}
            disabled={isSaving}
            aria-invalid={Boolean(fieldErrors.transactionDate) || undefined}
            onChange={(event) => setDate(event.target.value)}
          />
          {fieldErrors.transactionDate && (
            <p role="alert" className="text-[12px] text-danger mt-1 mb-0">
              {fieldErrors.transactionDate}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="split-ratio" className="gt-field-label">
            1 株を何株にするか<span className="text-danger"> *</span>
          </label>
          <input
            id="split-ratio"
            className="gt-field"
            style={{ textAlign: 'right' }}
            inputMode="decimal"
            placeholder="100"
            value={ratioText}
            disabled={isSaving}
            aria-invalid={Boolean(fieldErrors.ratio) || undefined}
            onChange={(event) => setRatioText(event.target.value)}
          />
          {fieldErrors.ratio ? (
            <p role="alert" className="text-[12px] text-danger mt-1 mb-0">
              {fieldErrors.ratio}
            </p>
          ) : (
            <p className="text-[12px] text-text-muted mt-1 mb-0">
              {ratio != null
                ? isConsolidation
                  ? `株式併合（1 株 → ${ratio} 株）`
                  : `株式分割（1 株 → ${formatNumber(ratio)} 株）`
                : '分割は 100（1 株 → 100 株）、併合は 0.1（10 株 → 1 株）のように入力します'}
            </p>
          )}
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="split-notes" className="gt-field-label">
            メモ（決議日など）
          </label>
          <input id="split-notes" className="gt-field" value={notes} maxLength={4000} disabled={isSaving} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-[13px] font-semibold text-text-heading m-0">記録される内容の確認</h3>
        {!preview ? (
          <p className="gt-table-empty m-0">株式の種類・効力発生日・割合を入れると、株主ごとの変化を表示します。</p>
        ) : preview.rows.length === 0 ? (
          <p className="gt-table-empty m-0">効力発生日の時点でこの種類の株式を持つ株主がいないか、株式数が変わりません。</p>
        ) : (
          <>
            {preview.hasLaterTransactions && (
              <div className="mt-2">
                <NoticeList
                  items={[
                    {
                      level: 'error',
                      message:
                        '効力発生日より後の日付の異動が記録されています。分割・併合は、その種類の最後の異動より後の日付で記録してください（このままでは記録できません）。',
                    },
                  ]}
                />
              </div>
            )}
            <div className="gt-table-scroll" style={{ maxHeight: '260px', overflowY: 'auto' }}>
              <table className="gt-table">
                <thead>
                  <tr>
                    <th scope="col">株主</th>
                    <th scope="col" className="gt-num">現在</th>
                    <th scope="col" className="gt-num">{isConsolidation ? '併合後' : '分割後'}</th>
                    <th scope="col" className="gt-num">増減（記録する株式数）</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.stakeholderId}>
                      <td>
                        <span className="block w-max max-w-[14.5em] whitespace-normal">{row.name}</span>
                      </td>
                      <td className="gt-num">{formatNumber(row.before)}</td>
                      <td className="gt-num">{formatNumber(row.after)}</td>
                      <td className={`gt-num ${row.delta < 0 ? 'text-danger' : ''}`}>
                        {row.delta > 0 ? '+' : ''}
                        {formatNumber(row.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td>合計</td>
                    <td className="gt-num">{formatNumber(preview.totalBefore)}</td>
                    <td className="gt-num">{formatNumber(preview.totalAfter)}</td>
                    <td className={`gt-num ${preview.totalAfter < preview.totalBefore ? 'text-danger' : ''}`}>
                      {preview.totalAfter > preview.totalBefore ? '+' : ''}
                      {formatNumber(preview.totalAfter - preview.totalBefore)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[12px] text-text-muted mt-2 mb-0">1 株未満の端数は切り捨てて表示しています（端数の処理は会社法235条などの手続きによります）。</p>
          </>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-[13px] text-danger mt-4 mb-0">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-6">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          キャンセル
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving && <Loader2 className="animate-spin" />}
          分割・併合を記録する
        </Button>
      </div>
    </form>
  );
};

export const SplitDialog = (props: SplitDialogProps) => (
  <Modal isOpen={props.isOpen} onClose={props.onClose} title="株式分割・併合を記録" size="xl">
    {props.isOpen && <SplitForm {...props} />}
  </Modal>
);
