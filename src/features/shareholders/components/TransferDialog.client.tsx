'use client';

// 株式譲渡の記録。譲渡人の減少と譲受人の増加の 2 行を、サーバ（POST /api/equity/transfer）がまとめて作る。

import React, { useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { NoticeList } from '@/components/resource/parts';
import { formatDateJa, formatNumber, isValidDateText, parseNumberText, todayInTokyo } from '@/lib/equity/format';
import { buildRegistry } from '@/lib/equity/ledger';
import type { EquitySnapshot } from '@/lib/equity/types';
import { ApiError, apiFetch, errorMessage } from '@/lib/resources/client';
import { holdingOn } from '../services/ledgerViews';

interface TransferDialogProps {
  isOpen: boolean;
  onClose: () => void;
  snapshot: EquitySnapshot;
  hasBoardOfDirectors: boolean;
  hasTransferRestriction: boolean | null;
  onSaved: () => void;
}

const FieldError = ({ message }: { message?: string }) =>
  message ? (
    <p role="alert" className="text-[12px] text-danger mt-1 mb-0">
      {message}
    </p>
  ) : null;

const TransferForm = ({ onClose, snapshot, hasBoardOfDirectors, hasTransferRestriction, onSaved }: TransferDialogProps) => {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [shareClassId, setShareClassId] = useState(snapshot.shareClasses.length === 1 ? snapshot.shareClasses[0].id : '');
  const [date, setDate] = useState(todayInTokyo());
  const [sharesText, setSharesText] = useState('');
  const [priceText, setPriceText] = useState('');
  const [notes, setNotes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  // 譲渡人の候補は、いま株式を持っている株主
  const currentHolders = useMemo(() => {
    const ids = new Set(buildRegistry(snapshot).rows.map((row) => row.stakeholderId));
    return snapshot.stakeholders.filter((stakeholder) => ids.has(stakeholder.id));
  }, [snapshot]);
  const sortedClasses = useMemo(() => [...snapshot.shareClasses].sort((a, b) => a.sortOrder - b.sortOrder), [snapshot.shareClasses]);

  const validDate = isValidDateText(date) ? date : null;
  const held = fromId && shareClassId && validDate ? holdingOn(snapshot, fromId, shareClassId, validDate) : null;
  const shares = parseNumberText(sharesText);
  const exceeds = held != null && shares != null && shares > held;
  const className = sortedClasses.find((shareClass) => shareClass.id === shareClassId)?.name ?? '';

  const approvalOrgan = hasBoardOfDirectors ? '取締役会' : '株主総会';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      await apiFetch('/api/equity/transfer', {
        method: 'POST',
        body: JSON.stringify({
          fromStakeholderId: fromId,
          toStakeholderId: toId,
          shareClassId,
          transactionDate: date,
          shares: sharesText,
          pricePerShare: priceText,
          notes,
        }),
      });
      onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors);
      setFormError(errorMessage(caught, '株式譲渡の記録に失敗しました'));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <NoticeList
        items={[
          hasTransferRestriction === false
            ? {
                level: 'info',
                message:
                  '会社情報では「株式の譲渡制限に関する規定がある」がオフになっています。譲渡制限株式を譲渡する場合は、会社の承認（譲渡承認）が必要です（会社法136条〜139条）。',
              }
            : {
                level: 'warning',
                message: (
                  <>
                    譲渡制限株式の譲渡には、会社の承認（譲渡承認）が必要です（会社法136条〜139条）。この会社の承認機関は
                    <strong>{approvalOrgan}</strong>
                    です（{hasBoardOfDirectors ? '取締役会設置会社' : '取締役会を置かない会社'}。定款で別の機関を定めている場合はその機関）。承認の決議日などはメモに残してください。
                  </>
                ),
              },
        ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4 mt-4">
        <div>
          <label htmlFor="transfer-from" className="gt-field-label">
            譲渡人（株式を渡す株主）<span className="text-danger"> *</span>
          </label>
          <select
            id="transfer-from"
            className="gt-field gt-field-select"
            value={fromId}
            disabled={isSaving}
            aria-invalid={Boolean(fieldErrors.fromStakeholderId) || undefined}
            onChange={(event) => setFromId(event.target.value)}
          >
            <option value="">選択してください</option>
            {currentHolders.map((stakeholder) => (
              <option key={stakeholder.id} value={stakeholder.id}>
                {stakeholder.name}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.fromStakeholderId} />
        </div>
        <div>
          <label htmlFor="transfer-to" className="gt-field-label">
            譲受人（株式を受け取る人）<span className="text-danger"> *</span>
          </label>
          <select
            id="transfer-to"
            className="gt-field gt-field-select"
            value={toId}
            disabled={isSaving}
            aria-invalid={Boolean(fieldErrors.toStakeholderId) || undefined}
            onChange={(event) => setToId(event.target.value)}
          >
            <option value="">選択してください</option>
            {snapshot.stakeholders
              .filter((stakeholder) => stakeholder.id !== fromId)
              .map((stakeholder) => (
                <option key={stakeholder.id} value={stakeholder.id}>
                  {stakeholder.name}
                </option>
              ))}
          </select>
          {fieldErrors.toStakeholderId ? (
            <FieldError message={fieldErrors.toStakeholderId} />
          ) : (
            <p className="text-[12px] text-text-muted mt-1 mb-0">一覧に無い人は、先に「権利者」タブで登録してください。</p>
          )}
        </div>
        <div>
          <label htmlFor="transfer-class" className="gt-field-label">
            株式の種類<span className="text-danger"> *</span>
          </label>
          <select
            id="transfer-class"
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
          <FieldError message={fieldErrors.shareClassId} />
        </div>
        <div>
          <label htmlFor="transfer-date" className="gt-field-label">
            譲渡日（効力発生日）<span className="text-danger"> *</span>
          </label>
          <input
            id="transfer-date"
            type="date"
            className="gt-field"
            value={date}
            disabled={isSaving}
            aria-invalid={Boolean(fieldErrors.transactionDate) || undefined}
            onChange={(event) => setDate(event.target.value)}
          />
          <FieldError message={fieldErrors.transactionDate} />
        </div>

        <div className="sm:col-span-2 rounded-md border border-border bg-bg-subtle px-3 py-2 text-[13px] text-text-body" role="status">
          {held == null ? (
            '譲渡人・株式の種類・譲渡日を選ぶと、その時点の持株数を表示します。'
          ) : (
            <>
              {formatDateJa(validDate)} 時点の譲渡人の持株（{className}）: <strong className="tabular-nums text-text-heading">{formatNumber(held)}株</strong>
              {shares != null && shares > 0 && !exceeds && <span className="ml-3">→ 譲渡後 <strong className="tabular-nums text-text-heading">{formatNumber(held - shares)}株</strong></span>}
            </>
          )}
        </div>

        <div>
          <label htmlFor="transfer-shares" className="gt-field-label">
            譲渡する株式数<span className="text-danger"> *</span>
          </label>
          <input
            id="transfer-shares"
            className="gt-field"
            style={{ textAlign: 'right' }}
            inputMode="numeric"
            value={sharesText}
            disabled={isSaving}
            aria-invalid={Boolean(fieldErrors.shares) || exceeds || undefined}
            onChange={(event) => setSharesText(event.target.value)}
          />
          <FieldError message={fieldErrors.shares ?? (exceeds && held != null ? `譲渡できるのは ${formatNumber(held)}株までです` : undefined)} />
        </div>
        <div>
          <label htmlFor="transfer-price" className="gt-field-label">
            1 株あたりの譲渡価格
          </label>
          <input
            id="transfer-price"
            className="gt-field"
            style={{ textAlign: 'right' }}
            inputMode="decimal"
            value={priceText}
            disabled={isSaving}
            aria-invalid={Boolean(fieldErrors.pricePerShare) || undefined}
            onChange={(event) => setPriceText(event.target.value)}
          />
          {fieldErrors.pricePerShare ? (
            <FieldError message={fieldErrors.pricePerShare} />
          ) : (
            <p className="text-[12px] text-text-muted mt-1 mb-0">株主間の売買の価格です（会社への払込みではありません）。空欄でも記録できます。</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="transfer-notes" className="gt-field-label">
            メモ（譲渡承認の決議日・契約日など）
          </label>
          <textarea
            id="transfer-notes"
            className="gt-field"
            style={{ minHeight: '84px', height: 'auto', padding: '9px 11px', lineHeight: 1.6 }}
            value={notes}
            maxLength={4000}
            disabled={isSaving}
            onChange={(event) => setNotes(event.target.value)}
          />
          <FieldError message={fieldErrors.notes} />
        </div>
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
          譲渡を記録する
        </Button>
      </div>
    </form>
  );
};

export const TransferDialog = (props: TransferDialogProps) => (
  <Modal isOpen={props.isOpen} onClose={props.onClose} title="株式譲渡を記録" size="xl">
    {/* 開くたびに入力を初期化する */}
    {props.isOpen && <TransferForm {...props} />}
  </Modal>
);
