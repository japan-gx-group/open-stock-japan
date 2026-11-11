'use client';

// 権利者（株主・新株予約権者・転換型証券の投資家）の一覧と登録・編集・削除。

import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { formatNumber, formatYenJa } from '@/lib/equity/format';
import { optionLabel, STAKEHOLDER_KINDS, STAKEHOLDER_RELATIONSHIPS, type EquitySnapshot, type Stakeholder } from '@/lib/equity/types';
import { deleteItem } from '@/lib/resources/client';
import type { ResourceRow } from '@/lib/resources/fields';
import { filterStakeholders, summarizeStakeholders } from '../services/ledgerViews';

/** 連絡先の 2 行目（担当者・電話番号）。どちらも無ければ空文字 */
const contactSub = (stakeholder: Stakeholder): string =>
  [stakeholder.contactPerson ? `担当 ${stakeholder.contactPerson}` : null, stakeholder.phone].filter(Boolean).join(' ／ ');

export const StakeholdersTab = ({
  snapshot,
  canEdit,
  onChanged,
  renderActions,
}: {
  snapshot: EquitySnapshot;
  canEdit: boolean;
  onChanged: () => void;
  /** 拡張ポイント: 「ポータル」列に出す操作（株主ポータルへの招待など）。渡されたときだけ列を出す */
  renderActions?: (stakeholder: Stakeholder) => React.ReactNode;
}) => {
  const [query, setQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Stakeholder | null>(null);
  const [deleting, setDeleting] = useState<Stakeholder | null>(null);

  const summaries = useMemo(() => summarizeStakeholders(snapshot), [snapshot]);
  const visible = useMemo(() => filterStakeholders(summaries, query), [summaries, query]);
  const columnCount = 6 + (renderActions ? 1 : 0) + (canEdit ? 1 : 0);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative" style={{ flex: '1 1 260px', maxWidth: '420px' }}>
          <label htmlFor="stakeholder-search" className="sr-only">
            権利者を検索
          </label>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none" />
          <input
            id="stakeholder-search"
            type="search"
            className="gt-field"
            style={{ paddingLeft: '34px' }}
            placeholder="氏名・住所・メールアドレス・区分で検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {canEdit && (
          <Button
            type="button"
            className="ml-auto"
            onClick={() => {
              setEditing(null);
              setIsFormOpen(true);
            }}
          >
            <Plus />
            権利者を登録
          </Button>
        )}
      </div>

      {/* relative: 見出しの sr-only（絶対配置）を、横スクロールする枠の中に収めるため */}
      <div className="gt-table-scroll relative mt-2">
        <table className="gt-table">
          <thead>
            <tr>
              <th scope="col">氏名・名称</th>
              <th scope="col">会社との関係・区分</th>
              <th scope="col" className="gt-num">持株数</th>
              <th scope="col" className="gt-num" title="新株予約権（未行使の残数を株式に換算した数）">
                新株予約権
              </th>
              <th scope="col" className="gt-num" title="転換型証券の未転換の投資額">
                転換型
              </th>
              <th scope="col">連絡先</th>
              {renderActions && <th scope="col">ポータル</th>}
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
                  {summaries.length === 0
                    ? '権利者がまだ登録されていません。株主・新株予約権者・投資家を登録してください。'
                    : '条件に合う権利者がいません。'}
                </td>
              </tr>
            )}
            {visible.map(({ stakeholder, issuedShares, optionShares, convertibleAmount }) => (
              <tr key={stakeholder.id}>
                {/* 氏名は 14 文字まで 1 行に収まる幅（14 文字 ＋ セルの左右の余白）を確保し、それより長い名称だけ折り返す。フリガナは列を広げない */}
                <td className="gt-wrap min-w-[calc(14em+18px)] font-medium">
                  {stakeholder.name}
                  {stakeholder.nameKana && (
                    <span className="gt-cell-clip text-[11.5px] font-normal text-text-muted" title={stakeholder.nameKana}>
                      {stakeholder.nameKana}
                    </span>
                  )}
                </td>
                <td>
                  {optionLabel(STAKEHOLDER_RELATIONSHIPS, stakeholder.relationship)}
                  <div className="text-[11.5px] text-text-muted">{optionLabel(STAKEHOLDER_KINDS, stakeholder.kind)}</div>
                </td>
                <td className="gt-num">{issuedShares === 0 ? '—' : formatNumber(issuedShares)}</td>
                <td className="gt-num">{optionShares === 0 ? '—' : formatNumber(optionShares)}</td>
                <td className="gt-num">{convertibleAmount === 0 ? '—' : formatYenJa(convertibleAmount)}</td>
                {/* メールアドレスは長いと列を広げるので、セルの幅で切る（全文は title）。担当者・電話の行も列を広げない */}
                <td className="max-w-[176px] truncate text-[12px]" title={stakeholder.email ?? undefined}>
                  {stakeholder.email ?? <span className="text-text-subtle">メール未登録</span>}
                  {contactSub(stakeholder) && (
                    <span className="gt-cell-clip text-text-muted" title={contactSub(stakeholder)}>
                      {contactSub(stakeholder)}
                    </span>
                  )}
                </td>
                {renderActions && <td>{renderActions(stakeholder)}</td>}
                {/* アイコンのボタンは自身に余白を持つので、セルの左右の余白は付けない */}
                {canEdit && (
                  <td className="px-0 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${stakeholder.name} を編集`}
                      title="編集"
                      onClick={() => {
                        setEditing(stakeholder);
                        setIsFormOpen(true);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-danger"
                      aria-label={`${stakeholder.name} を削除`}
                      title="削除"
                      onClick={() => setDeleting(stakeholder)}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-3">
        新株予約権は未行使の残数を株式に換算した数、転換型は未転換の投資額です。株式・新株予約権・転換型証券の記録がある権利者は削除できません。
      </p>

      <ResourceFormDialog
        resource="stakeholders"
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        initial={editing ? (editing as unknown as ResourceRow) : null}
        onSaved={onChanged}
      />
      <ConfirmDialog
        isOpen={deleting !== null}
        title="権利者の削除"
        message={
          <>
            「<strong>{deleting?.name}</strong>」を削除します。株式の異動・新株予約権の割当・転換型証券の投資などの記録から参照されている場合は削除できません。
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteItem('stakeholders', deleting.id);
          setDeleting(null);
          onChanged();
        }}
      />
    </div>
  );
};
