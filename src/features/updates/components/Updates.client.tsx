'use client';

// 株主へのお知らせ（社内向け）。お知らせ・月次レポートの作成、AI による下書き、株主ポータルでの見え方の確認、
// 公開・取り下げ、添付の文書。一覧は社内の全員、作成・編集・公開は管理者とメンバー（API が確かめる）。
// メールの一斉送信はしない（株主のメールアドレスの一覧をコピーして、自分のメールソフトから送る）。

import React, { useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { DraftDialog } from '@/components/resource/DraftDialog.client';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/resource/parts';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { buildFiguresSummary, toFigures } from '@/features/financials/services/analysis';
import { fullRowPayload } from '@/features/financials/services/payload';
import { EntityDocuments } from '@/features/library/components/EntityDocuments.client';
import { isoToTokyoDate } from '@/features/library/services/format';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEquitySnapshot } from '@/hooks/useEquitySnapshot';
import { useResourceList } from '@/hooks/useResourceList';
import { formatDateJa, todayInTokyo } from '@/lib/equity/format';
import { optionLabel } from '@/lib/equity/types';
import { deleteItem, saveItem } from '@/lib/resources/client';
import { UPDATE_CATEGORIES } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';
import { canEdit } from '@/types/role';
import { buildUpdateDraftContext, shareholderContacts } from '../services/draftContext';
import { UpdateBody } from './UpdateBody';

const isPublished = (row: ResourceRow | null | undefined): boolean => row?.status === 'published';

const StatusPill = ({ row }: { row: ResourceRow }) =>
  isPublished(row) ? <span className="gt-pill gt-pill-sm gt-pill-good">公開中</span> : <span className="gt-pill gt-pill-sm gt-pill-neutral">下書き</span>;

const publishedDateOf = (row: ResourceRow): string =>
  isPublished(row) && typeof row.publishedAt === 'string' ? formatDateJa(isoToTokyoDate(row.publishedAt)) : '—';

/** 株主のメールアドレスの一覧（自分のメールソフトの BCC に貼る用） */
const ShareholderEmails = () => {
  const snapshot = useEquitySnapshot();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const contacts = useMemo(() => (snapshot.data ? shareholderContacts(snapshot.data) : null), [snapshot.data]);
  const text = contacts?.emails.join(', ') ?? '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <details className="gt-card mt-4">
      <summary className="cursor-pointer text-[13.5px] font-semibold text-text-heading">株主にメールで知らせるとき（メールアドレスの一覧）</summary>
      <div className="mt-3">
        <p className="text-[12.5px] leading-relaxed text-text-muted mt-0 mb-2">
          このツールからメールの一斉送信は行いません。現在株式を持っている株主のメールアドレスをコピーして、お使いのメールソフトから送ってください。
          株主どうしにアドレスが見えないよう、宛先は BCC に入れてください。
        </p>
        {snapshot.isLoading && !snapshot.data ? (
          <p className="text-[12.5px] text-text-muted m-0">読み込んでいます…</p>
        ) : snapshot.error || !contacts ? (
          <p className="text-[12.5px] text-danger m-0">{snapshot.error ?? '株主の情報を取得できませんでした'}</p>
        ) : contacts.emails.length === 0 ? (
          <p className="text-[12.5px] text-text-muted m-0">メールアドレスが登録されている株主がいません。</p>
        ) : (
          <>
            <textarea
              className="gt-field w-full"
              style={{ height: 'auto', minHeight: '64px', padding: '10px 12px', lineHeight: 1.6 }}
              readOnly
              aria-label="株主のメールアドレス"
              value={text}
              onFocus={(event) => event.target.select()}
            />
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <button type="button" className="gt-btn" style={{ height: '32px' }} onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'コピーしました' : 'コピー'}
              </button>
              <span className="text-[12px] text-text-muted">
                株主 {contacts.shareholderCount} 名のうち {contacts.emails.length} 件
              </span>
              {copyError && <span className="text-[12px] text-danger">コピーできませんでした。欄を選択してコピーしてください。</span>}
            </div>
          </>
        )}
        {contacts && contacts.missing.length > 0 && (
          <p className="text-[12px] text-warning mt-2 mb-0">メールアドレスが未登録の株主: {contacts.missing.join('、')}</p>
        )}
      </div>
    </details>
  );
};

/** AI の下書きの材料（メモ）を入力する */
const DraftMaterialDialog = ({
  row,
  hasPublishedReport,
  onCancel,
  onNext,
}: {
  row: ResourceRow | null;
  hasPublishedReport: boolean;
  onCancel: () => void;
  onNext: (memo: string, includeFigures: boolean) => void;
}) => {
  const [memo, setMemo] = useState('');
  const [includeFigures, setIncludeFigures] = useState(false);
  return (
    <Modal isOpen={row != null} onClose={onCancel} title="AI で下書き: 伝えたいこと" size="lg">
      <p className="text-[12.5px] leading-relaxed text-text-muted mt-0 mb-3">
        伝えたい内容を箇条書きなどで入力してください。AI はここに書かれた事実だけを使って文章にします（数字や予定を作り出さないよう指示しています）。
        次の画面で下書きを確認・編集してから保存します。
      </p>
      <label htmlFor="update-draft-memo" className="gt-field-label">
        メモ
      </label>
      <textarea
        id="update-draft-memo"
        className="gt-field w-full"
        style={{ height: 'auto', minHeight: '160px', padding: '10px 12px', lineHeight: 1.7 }}
        value={memo}
        maxLength={8000}
        placeholder={'例:\n- 10月の新規契約は 3 社、解約は 0\n- 採用: エンジニア 1 名が 11 月に入社\n- 12 月に新機能を公開する予定'}
        onChange={(event) => setMemo(event.target.value)}
      />
      <label className={`flex items-start gap-2 mt-3 text-[13px] ${hasPublishedReport ? 'text-text-main cursor-pointer' : 'text-text-subtle'}`}>
        <input type="checkbox" className="mt-[3px]" checked={includeFigures} disabled={!hasPublishedReport} onChange={(event) => setIncludeFigures(event.target.checked)} />
        <span>
          株主に公開済みの最新の決算の数字を材料に含める
          {!hasPublishedReport && <span className="block text-[12px]">（公開済みの決算情報がありません）</span>}
        </span>
      </label>
      <div className="flex justify-end gap-2 mt-5">
        <Button type="button" variant="outline" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="button" onClick={() => onNext(memo, includeFigures)} disabled={!memo.trim() && !includeFigures}>
          下書きへ進む
        </Button>
      </div>
    </Modal>
  );
};

export const Updates = () => {
  const { role, profile } = useCurrentUser();
  const editable = canEdit(role);
  const updates = useResourceList('shareholder-updates');
  const reports = useResourceList('financial-reports');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<ResourceRow | null>(null);
  const [toDelete, setToDelete] = useState<ResourceRow | null>(null);
  const [toToggle, setToToggle] = useState<ResourceRow | null>(null);
  const [material, setMaterial] = useState<ResourceRow | null>(null);
  const [draft, setDraft] = useState<{ row: ResourceRow; context: string } | null>(null);

  const rows = useMemo(() => updates.data ?? [], [updates.data]);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  // 株主に公開済みの決算のうち、期間がいちばん新しいもの（一覧は期間の新しい順）
  const latestPublishedReport = useMemo(
    () => (reports.data ?? []).find((row) => row.isPublishedToShareholders === true) ?? null,
    [reports.data],
  );

  const reload = () => updates.reload();

  const remove = async () => {
    if (!toDelete) return;
    await deleteItem('shareholder-updates', toDelete.id);
    setToDelete(null);
    await reload();
  };

  const togglePublish = async () => {
    if (!toToggle) return;
    await saveItem(
      'shareholder-updates',
      fullRowPayload('shareholder-updates', toToggle, { status: isPublished(toToggle) ? 'draft' : 'published' }),
      toToggle.id,
    );
    setToToggle(null);
    await reload();
  };

  const startDraft = (memo: string, includeFigures: boolean) => {
    if (!material) return;
    const context = buildUpdateDraftContext({
      companyName: profile?.organizationName,
      title: String(material.title ?? ''),
      category: String(material.category ?? ''),
      memo,
      figuresSummary: includeFigures && latestPublishedReport ? buildFiguresSummary(toFigures(latestPublishedReport)) : null,
      today: todayInTokyo(),
    });
    setDraft({ row: material, context });
    setMaterial(null);
  };

  const saveBody = async (row: ResourceRow, body: string) => {
    await saveItem('shareholder-updates', fullRowPayload('shareholder-updates', row, { body }), row.id);
    await reload();
  };

  const addButton = editable ? (
    <button type="button" className="gt-btn-primary" onClick={() => setIsCreating(true)}>
      <Plus size={15} />
      お知らせを作成
    </button>
  ) : null;

  return (
    <div className="page-body">
      <PageHeading title="株主へのお知らせ" description="お知らせ・月次レポートを作成し、株主ポータルに公開します" primaryAction={addButton} />

      {updates.isLoading && !updates.data ? (
        <LoadingBlock />
      ) : updates.error && !updates.data ? (
        <ErrorBlock message={updates.error} onRetry={() => void reload()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="お知らせはまだありません"
          description="決算の報告、資金調達の完了、月次レポートなどを作成して公開すると、株主ポータルに表示されます。下書きの状態では株主には見えません。"
          action={addButton ?? undefined}
        />
      ) : (
        <>
          <div className="gt-card gt-card-table">
            <div className="gt-table-scroll">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th>タイトル</th>
                    <th>種類</th>
                    <th>状態</th>
                    <th>公開日</th>
                    <th>作成日</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isSelected = selected?.id === row.id;
                    return (
                      <tr key={row.id} className={isSelected ? 'bg-primary-bg/50' : undefined}>
                        <td className="gt-wrap">
                          <button
                            type="button"
                            className="text-left font-medium text-primary hover:underline bg-transparent border-0 p-0 cursor-pointer break-words"
                            aria-pressed={isSelected}
                            onClick={() => setSelectedId(row.id)}
                          >
                            {String(row.title ?? '')}
                          </button>
                        </td>
                        <td>{optionLabel(UPDATE_CATEGORIES, String(row.category ?? ''))}</td>
                        <td>
                          <StatusPill row={row} />
                        </td>
                        <td>{publishedDateOf(row)}</td>
                        <td>{formatDateJa(isoToTokyoDate(row.createdAt))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selected && (
            <div className="gt-card mt-4" key={selected.id}>
              <div className="gt-card-head">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="gt-card-title m-0 break-words">{String(selected.title ?? '')}</h2>
                    <span className="gt-pill gt-pill-sm gt-pill-neutral">{optionLabel(UPDATE_CATEGORIES, String(selected.category ?? ''))}</span>
                    <StatusPill row={selected} />
                  </div>
                  <div className="gt-card-sub">
                    {isPublished(selected) ? `公開日: ${publishedDateOf(selected)}・株主ポータルに表示されています` : '下書きです。株主には表示されていません'}
                  </div>
                </div>
                {editable && (
                  <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                    <button type="button" className="gt-btn" onClick={() => setMaterial(selected)}>
                      <Sparkles size={14} />
                      AI で下書き
                    </button>
                    <button type="button" className="gt-btn" onClick={() => setEditing(selected)}>
                      <Pencil size={14} />
                      編集
                    </button>
                    <button type="button" className={isPublished(selected) ? 'gt-btn' : 'gt-btn-primary'} onClick={() => setToToggle(selected)}>
                      {isPublished(selected) ? <EyeOff size={14} /> : <Eye size={14} />}
                      {isPublished(selected) ? '公開をやめる' : '公開する'}
                    </button>
                    <button type="button" className="gt-iconbtn" aria-label={`${String(selected.title ?? '')} を削除`} title="削除" onClick={() => setToDelete(selected)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 mt-4">
                <section className="min-w-0">
                  <h3 className="text-[12px] font-medium text-text-muted mt-0 mb-2">株主ポータルでの見え方（プレビュー）</h3>
                  <div className="rounded-md border border-border bg-bg-subtle px-5 py-5">
                    <div className="text-[12px] text-text-muted">
                      {isPublished(selected) ? publishedDateOf(selected) : '（公開日）'}・{optionLabel(UPDATE_CATEGORIES, String(selected.category ?? ''))}
                    </div>
                    <div className="text-[20px] font-semibold text-text-heading tracking-tight mt-1 mb-4 break-words">{String(selected.title ?? '')}</div>
                    <UpdateBody body={String(selected.body ?? '')} />
                  </div>
                </section>
                <section className="min-w-0">
                  <h3 className="text-[12px] font-medium text-text-muted mt-0 mb-2">添付の文書</h3>
                  <EntityDocuments
                    entityType="shareholder_update"
                    entityId={selected.id}
                    canEdit={editable}
                    defaults={{ category: 'report', visibility: 'shareholders' }}
                    addLabel="添付を追加"
                    warnInternal={isPublished(selected)}
                  />
                  <p className="text-[12px] leading-relaxed text-text-muted mt-3 mb-0">
                    添付は「全株主に公開」で登録されます。お知らせが下書きのあいだは株主ポータルの一覧に出ませんが、公開範囲そのものは登録した時点で有効です。
                    公開前に見せたくない文書は、公開範囲を「社内のみ」にしておき、公開するときにライブラリの「共有」で変えてください。
                  </p>
                </section>
              </div>
            </div>
          )}
        </>
      )}

      <ShareholderEmails />

      <ResourceFormDialog
        resource="shareholder-updates"
        isOpen={isCreating}
        defaults={{ status: 'draft' }}
        hiddenKeys={['status']}
        onClose={() => setIsCreating(false)}
        onSaved={(row) => {
          setSelectedId(row.id);
          void reload();
        }}
      />
      <ResourceFormDialog
        resource="shareholder-updates"
        isOpen={editing != null}
        initial={editing}
        hiddenKeys={['status']}
        onClose={() => setEditing(null)}
        onSaved={() => void reload()}
      />
      <DraftMaterialDialog
        key={material?.id ?? 'none'}
        row={material}
        hasPublishedReport={latestPublishedReport != null}
        onCancel={() => setMaterial(null)}
        onNext={startDraft}
      />
      <DraftDialog
        isOpen={draft != null}
        title={`お知らせの下書き: ${String(draft?.row.title ?? '')}`}
        kind="shareholder_update"
        context={draft?.context ?? ''}
        initialBody={String(draft?.row.body ?? '')}
        useLabel="本文として保存"
        onUse={async (body) => {
          if (draft) await saveBody(draft.row, body);
        }}
        onClose={() => setDraft(null)}
      />
      <ConfirmDialog
        isOpen={toToggle != null}
        destructive={false}
        title={isPublished(toToggle) ? 'お知らせの公開をやめる' : 'お知らせを公開'}
        confirmLabel={isPublished(toToggle) ? '公開をやめる' : '公開する'}
        message={
          isPublished(toToggle) ? (
            <>「{String(toToggle?.title ?? '')}」を下書きに戻します。株主ポータルに表示されなくなります（すでに読んだ株主の手元の情報は取り消せません）。</>
          ) : (
            <>
              「{String(toToggle?.title ?? '')}」を公開します。株主ポータルのアカウントを持つ<strong>すべての株主</strong>が、本文と、公開範囲が「全株主に公開」の添付を読めるようになります。
              公開の前に、プレビューで内容を確かめてください。メールでの通知は自動では送られません。
              {!String(toToggle?.body ?? '').trim() && <span className="block mt-2 text-warning">本文が空です。</span>}
            </>
          )
        }
        onCancel={() => setToToggle(null)}
        onConfirm={togglePublish}
      />
      <ConfirmDialog
        isOpen={toDelete != null}
        title="お知らせを削除"
        message={
          <>
            「{String(toDelete?.title ?? '')}」を削除します。{isPublished(toDelete) && '株主ポータルからも見えなくなります。'}
            添付の文書は削除されず、ライブラリに残ります（公開範囲もそのままです）。元には戻せません。
          </>
        }
        onCancel={() => setToDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
};
