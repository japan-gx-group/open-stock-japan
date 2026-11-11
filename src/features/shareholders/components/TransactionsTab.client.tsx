'use client';

// 株式の異動の一覧（日付順）と、異動の登録・株式譲渡・株式分割の記録。

import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Pencil, Plus, Split, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { formatDateJa, formatNumber, formatYen, todayInTokyo } from '@/lib/equity/format';
import type { EquitySnapshot } from '@/lib/equity/types';
import { deleteItem } from '@/lib/resources/client';
import type { ResourceRow } from '@/lib/resources/fields';
import { transactionViews, type TransactionView } from '../services/ledgerViews';
import { SplitDialog } from './SplitDialog.client';
import { TransferDialog } from './TransferDialog.client';

export const TransactionsTab = ({
  snapshot,
  canEdit,
  onChanged,
  hasBoardOfDirectors,
  hasTransferRestriction,
}: {
  snapshot: EquitySnapshot;
  canEdit: boolean;
  onChanged: () => void;
  hasBoardOfDirectors: boolean;
  /** 定款に株式の譲渡制限の定めがあるか。会社情報を読めていなければ null */
  hasTransferRestriction: boolean | null;
}) => {
  const [holderFilter, setHolderFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<TransactionView | null>(null);
  const [deleting, setDeleting] = useState<TransactionView | null>(null);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isSplitOpen, setIsSplitOpen] = useState(false);

  const views = useMemo(() => transactionViews(snapshot), [snapshot]);
  const holders = useMemo(() => {
    const ids = new Set(snapshot.shareTransactions.map((transaction) => transaction.stakeholderId));
    return snapshot.stakeholders.filter((stakeholder) => ids.has(stakeholder.id));
  }, [snapshot]);
  const visible = holderFilter ? views.filter((view) => view.transaction.stakeholderId === holderFilter) : views;
  const columnCount = canEdit ? 7 : 6;
  const groupSize = deleting?.transaction.groupId
    ? views.filter((view) => view.transaction.groupId === deleting.transaction.groupId).length
    : 1;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div style={{ flex: '0 1 260px' }}>
          <label htmlFor="transaction-holder" className="gt-field-label">
            株主で絞り込む
          </label>
          <select
            id="transaction-holder"
            className="gt-field gt-field-select"
            value={holderFilter}
            onChange={(event) => setHolderFilter(event.target.value)}
          >
            <option value="">すべての株主</option>
            {holders.map((stakeholder) => (
              <option key={stakeholder.id} value={stakeholder.id}>
                {stakeholder.name}
              </option>
            ))}
          </select>
        </div>
        {canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setIsSplitOpen(true)}>
              <Split />
              株式分割・併合を記録
            </Button>
            <Button type="button" variant="outline" onClick={() => setIsTransferOpen(true)}>
              <ArrowLeftRight />
              株式譲渡を記録
            </Button>
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setIsFormOpen(true);
              }}
            >
              <Plus />
              異動を登録
            </Button>
          </div>
        )}
      </div>

      {/* 列は「いつ・誰が／何が起きたか（＋ラウンド）／何株（＋種類）／いくら（＋単価）／相手方・メモ」。
          関係の近い項目を 2 行のセルにまとめ、1280px 幅で横スクロールなしに収める。
          relative: 見出しの sr-only（絶対配置）を、横スクロールする枠の中に収めるため */}
      <div className="gt-table-scroll relative mt-2">
        <table className="gt-table">
          <thead>
            <tr>
              <th scope="col">異動日</th>
              <th scope="col">株主</th>
              <th scope="col">異動の種類・ラウンド</th>
              <th scope="col" className="gt-num" title="株式数・株式の種類">
                株式数・種類
              </th>
              <th scope="col" className="gt-num">金額・1 株あたり</th>
              <th scope="col">相手方・メモ</th>
              {canEdit && (
                <th scope="col">
                  <span className="sr-only">操作</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="gt-table-empty whitespace-normal">
                  {views.length === 0
                    ? '株式の異動がまだ登録されていません。設立時の発行から順に登録してください。'
                    : 'この株主の異動はありません。'}
                </td>
              </tr>
            )}
            {visible.map((view) => {
              const { transaction } = view;
              return (
                <tr key={transaction.id}>
                  <td className="tabular-nums">{formatDateJa(transaction.transactionDate)}</td>
                  {/* 氏名は 14 文字ほどまで 1 行に収め、それより長い名称だけ折り返す（短い氏名だけなら列は広がらない） */}
                  <td className="font-medium">
                    <span className="block w-max max-w-[14.5em] whitespace-normal">{view.stakeholderName}</span>
                  </td>
                  <td>
                    {view.typeLabel}
                    {(view.roundName || view.isGrouped) && (
                      <div className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
                        {view.roundName}
                        {view.isGrouped && (
                          <span className="gt-pill gt-pill-sm gt-pill-neutral" title="譲渡・分割としてまとめて記録した行です">
                            一括記録
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="gt-num">
                    <span className={transaction.shares < 0 ? 'text-danger' : undefined}>
                      {transaction.shares > 0 ? '+' : ''}
                      {formatNumber(transaction.shares)}
                    </span>
                    <div className="text-[11.5px] text-text-muted">{view.shareClassName}</div>
                  </td>
                  <td className="gt-num">
                    {view.amount != null ? formatYen(view.amount) : '—'}
                    {transaction.pricePerShare != null && (
                      <div className="text-[11.5px] text-text-muted">1 株 {formatYen(transaction.pricePerShare, 2)}</div>
                    )}
                  </td>
                  {/* 1 行目に相手方、続けてメモ（セルの文字はメモの色にし、相手方だけ本文の色に戻す）。メモの改行はそのまま出す */}
                  <td className="gt-wrap-sm whitespace-pre-wrap text-[12.5px] text-text-muted">
                    {transaction.counterparty && <span className="text-text-heading">{transaction.counterparty}</span>}
                    {transaction.counterparty && transaction.notes && <br />}
                    {transaction.notes}
                    {!transaction.counterparty && !transaction.notes && <span className="text-text-subtle">—</span>}
                  </td>
                  {/* アイコンのボタンは自身に余白を持つので、セルの左右の余白は付けない */}
                  {canEdit && (
                    <td className="px-0 text-right">
                      {!view.isGrouped && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${formatDateJa(transaction.transactionDate)} ${view.stakeholderName} の異動を編集`}
                          title="編集"
                          onClick={() => {
                            setEditing(view);
                            setIsFormOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-danger"
                        aria-label={`${formatDateJa(transaction.transactionDate)} ${view.stakeholderName} の異動を削除`}
                        title={view.isGrouped ? '削除（まとめて記録した行をすべて削除します）' : '削除'}
                        onClick={() => setDeleting(view)}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-3">
        株式数は取得を正、減少を負（赤字）で表示しています。「一括記録」の行は、株式譲渡・株式分割としてまとめて作った行です。編集はできず、削除すると同じ譲渡・分割の行がすべて削除されます（直すときは、削除してから記録し直してください）。
      </p>

      <ResourceFormDialog
        resource="share-transactions"
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        initial={editing ? (editing.transaction as unknown as ResourceRow) : null}
        defaults={{ transactionDate: todayInTokyo() }}
        onSaved={onChanged}
      />
      <ConfirmDialog
        isOpen={deleting !== null}
        title="株式の異動の削除"
        message={
          deleting && (
            <>
              {formatDateJa(deleting.transaction.transactionDate)} の「<strong>{deleting.stakeholderName}</strong>」の{deleting.typeLabel}（
              {formatNumber(deleting.transaction.shares)}株）を削除します。
              {deleting.isGrouped && (
                <>
                  <br />
                  この行は{deleting.transaction.transactionType === 'split' ? '株式分割・併合' : '株式譲渡'}としてまとめて記録されているため、同じ記録の
                  <strong> {groupSize} 行すべて</strong>が削除されます。
                </>
              )}
              <br />
              株主名簿と資本政策表の株式数が変わります。
            </>
          )
        }
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteItem('share-transactions', deleting.transaction.id);
          setDeleting(null);
          onChanged();
        }}
      />
      <TransferDialog
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        snapshot={snapshot}
        hasBoardOfDirectors={hasBoardOfDirectors}
        hasTransferRestriction={hasTransferRestriction}
        onSaved={onChanged}
      />
      <SplitDialog isOpen={isSplitOpen} onClose={() => setIsSplitOpen(false)} snapshot={snapshot} hasBoardOfDirectors={hasBoardOfDirectors} onSaved={onChanged} />
    </div>
  );
};
