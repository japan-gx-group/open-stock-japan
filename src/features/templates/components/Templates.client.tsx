'use client';

// 文書テンプレートの画面。招集通知・議事録・J-KISS の発行に使う書類などの、ひな形を作って保管し、
// 登録済みの内容（会議・転換型証券の回次）を差し込んで文書を作る。
// 一覧と文書の作成は社内の全員、テンプレートの作成・編集・削除は管理者とメンバー（API が確かめる）。

import React, { useMemo, useState } from 'react';
import { CheckCircle2, Copy, FileText, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/resource/parts';
import { isoToTokyoDate } from '@/features/library/services/format';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useResourceList } from '@/hooks/useResourceList';
import { formatDateJa } from '@/lib/equity/format';
import { deleteItem, saveItem } from '@/lib/resources/client';
import { canEdit } from '@/types/role';
import { analyzeTemplate } from '../services/fill';
import { getTemplateKind, isTemplateKindId, scopesOfKind, TEMPLATE_CATEGORIES, templateKindName, type TemplateCategory } from '../services/kinds';
import { countNeedsReview } from '../services/placeholders';
import type { TemplateDraft, TemplateRow } from '../types';
import { ComposeDialog } from './ComposeDialog.client';
import { NewTemplateDialog } from './NewTemplateDialog.client';
import { TemplateBody } from './TemplateBody';
import { TemplateEditor } from './TemplateEditor.client';

const StatusPill = ({ row }: { row: TemplateRow }) =>
  row.status === 'reviewed' ? (
    <span className="gt-pill gt-pill-sm gt-pill-good">確認済み</span>
  ) : (
    <span className="gt-pill gt-pill-sm gt-pill-warn">確認中</span>
  );

const categoryOf = (row: TemplateRow): TemplateCategory | null => (isTemplateKindId(row.kind) ? getTemplateKind(row.kind).category : null);

const toDraft = (row: TemplateRow, overrides: Partial<TemplateDraft> = {}): TemplateDraft => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  notes: row.notes,
  status: row.status,
  origin: null,
  ...overrides,
});

export const Templates = () => {
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  const templates = useResourceList<TemplateRow>('document-templates');
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [composing, setComposing] = useState<TemplateRow | null>(null);
  const [toDelete, setToDelete] = useState<TemplateRow | null>(null);
  const [toReview, setToReview] = useState<TemplateRow | null>(null);

  const all = useMemo(() => (templates.data ?? []).filter((row) => isTemplateKindId(row.kind)), [templates.data]);
  const counts = useMemo(() => {
    const result = new Map<TemplateCategory, number>();
    for (const row of all) {
      const key = categoryOf(row);
      if (key) result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  }, [all]);
  const rows = useMemo(() => (category === 'all' ? all : all.filter((row) => categoryOf(row) === category)), [all, category]);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const selectedKind = selected ? getTemplateKind(selected.kind) : null;
  const selectedScopes = useMemo(() => (selectedKind ? scopesOfKind(selectedKind) : []), [selectedKind]);
  const selectedAnalysis = useMemo(() => (selected ? analyzeTemplate(selected.body, selectedScopes) : null), [selected, selectedScopes]);

  const reload = () => templates.reload();

  const remove = async () => {
    if (!toDelete) return;
    await deleteItem('document-templates', toDelete.id);
    setToDelete(null);
    await reload();
  };

  const toggleReviewed = async () => {
    if (!toReview) return;
    await saveItem(
      'document-templates',
      { title: toReview.title, kind: toReview.kind, body: toReview.body, notes: toReview.notes, status: toReview.status === 'reviewed' ? 'draft' : 'reviewed' },
      toReview.id,
    );
    setToReview(null);
    await reload();
  };

  const addButton = editable ? (
    <button type="button" className="gt-btn-primary" onClick={() => setIsCreating(true)}>
      <Plus size={15} />
      テンプレートを作る
    </button>
  ) : null;

  return (
    <div className="page-body">
      <PageHeading
        title="文書テンプレート"
        description="招集通知・議事録・J-KISS の発行に使う書類のひな形を作り、登録済みの内容を差し込んで文書にします"
        primaryAction={addButton}
      />

      {templates.isLoading && !templates.data ? (
        <LoadingBlock />
      ) : templates.error && !templates.data ? (
        <ErrorBlock message={templates.error} onRetry={() => void reload()} />
      ) : all.length === 0 ? (
        <EmptyState
          title="テンプレートはまだありません"
          description={
            <>
              株主総会の招集通知や議事録、J-KISS の発行に使う書類のひな形を作っておくと、会議や回次を選ぶだけで、日付・議案・金額の入った文書ができます。
              ひな形は、AI に書いてもらうことも、お手元の文面から作ることもできます。
            </>
          }
          action={addButton ?? undefined}
        />
      ) : (
        <>
          <div className="gt-card gt-card-table">
            <div className="gt-tabs" role="tablist" aria-label="テンプレートの分類" style={{ marginTop: 0 }}>
              {[{ value: 'all' as const, label: 'すべて', count: all.length }, ...TEMPLATE_CATEGORIES.map((item) => ({ value: item.value, label: item.label, count: counts.get(item.value) ?? 0 }))].map(
                (tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={category === tab.value}
                    className={`gt-tab ${category === tab.value ? 'gt-tab-active' : ''}`}
                    onClick={() => setCategory(tab.value)}
                  >
                    {tab.label}
                    <span className="gt-tab-count">{tab.count}</span>
                  </button>
                ),
              )}
            </div>
            {rows.length === 0 ? (
              <p className="text-[13px] text-text-muted px-1 py-6 m-0">この分類のテンプレートは、まだありません。</p>
            ) : (
              <div className="gt-table-scroll">
                <table className="gt-table">
                  <thead>
                    <tr>
                      <th>名前</th>
                      <th>種類</th>
                      <th>確認の状態</th>
                      <th>更新日</th>
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
                              {row.title}
                            </button>
                          </td>
                          <td>{templateKindName(row.kind)}</td>
                          <td>
                            <StatusPill row={row} />
                          </td>
                          <td>{formatDateJa(isoToTokyoDate(row.updatedAt ?? row.createdAt))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selected && selectedKind && selectedAnalysis && (
            <div className="gt-card mt-4" key={selected.id}>
              {/* 狭い画面では、名前の下にボタンを折り返す */}
              <div className="gt-card-head flex-wrap">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="gt-card-title m-0 break-words">{selected.title}</h2>
                    <StatusPill row={selected} />
                  </div>
                  <div className="gt-card-sub">
                    {templateKindName(selected.kind)}
                    {selectedKind.basis && `・${selectedKind.basis}`}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <button type="button" className="gt-btn-primary" onClick={() => setComposing(selected)}>
                    <FileText size={14} />
                    文書を作る
                  </button>
                  {editable && (
                    <>
                      <button type="button" className="gt-btn" onClick={() => setDraft(toDraft(selected))}>
                        <Pencil size={14} />
                        編集
                      </button>
                      <button type="button" className="gt-btn" onClick={() => setToReview(selected)}>
                        {selected.status === 'reviewed' ? <Undo2 size={14} /> : <CheckCircle2 size={14} />}
                        {selected.status === 'reviewed' ? '確認中に戻す' : '確認済みにする'}
                      </button>
                      <button
                        type="button"
                        className="gt-iconbtn"
                        aria-label={`${selected.title} を複製`}
                        title="複製"
                        onClick={() => setDraft(toDraft(selected, { id: null, title: `${selected.title}（複製）`.slice(0, 200), status: 'draft' }))}
                      >
                        <Copy size={15} />
                      </button>
                      <button type="button" className="gt-iconbtn" aria-label={`${selected.title} を削除`} title="削除" onClick={() => setToDelete(selected)}>
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 mt-4">
                <section className="min-w-0">
                  <h3 className="text-[12px] font-medium text-text-muted mt-0 mb-2">文面（色の付いた部分が、文書を作るときに置き換わります）</h3>
                  <div className="rounded-md border border-border bg-bg-subtle px-5 py-4 max-h-[640px] overflow-auto">
                    <TemplateBody body={selected.body} scopes={selectedScopes} />
                  </div>
                </section>
                <aside className="min-w-0 text-[13px] leading-relaxed text-text-body">
                  <h3 className="text-[12px] font-medium text-text-muted mt-0 mb-2">このテンプレートについて</h3>
                  <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-text-muted">差し込み項目</dt>
                    <dd className="m-0">{selectedAnalysis.used.length} 種類</dd>
                    <dt className="text-text-muted">【要確認】</dt>
                    <dd className="m-0">{countNeedsReview(selected.body)} か所</dd>
                    <dt className="text-text-muted">文書の作り方</dt>
                    <dd className="m-0">
                      {selectedKind.subject === 'company'
                        ? '会社情報から'
                        : selectedKind.subject === 'convertible_round'
                          ? selectedKind.perInvestor
                            ? '回次と投資家を選ぶ'
                            : '回次を選ぶ'
                          : '会議を選ぶ'}
                    </dd>
                  </dl>
                  {(selectedAnalysis.unknown.length > 0 || selectedAnalysis.outOfScope.length > 0) && (
                    <p className="text-warning mt-3 mb-0">
                      置き換えられない差し込み項目があります: {[...selectedAnalysis.unknown, ...selectedAnalysis.outOfScope].map((name) => `{{${name}}}`).join('、')}
                    </p>
                  )}

                  {selectedKind.items.length > 0 && (
                    <>
                      <h3 className="text-[12px] font-medium text-text-muted mt-4 mb-1.5">記載する事項（目安）</h3>
                      <ul className="m-0 pl-5 list-disc">
                        {selectedKind.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {selectedKind.cautions.length > 0 && (
                    <>
                      <h3 className="text-[12px] font-medium text-text-muted mt-4 mb-1.5">注意</h3>
                      <ul className="m-0 pl-5 list-disc">
                        {selectedKind.cautions.map((caution) => (
                          <li key={caution}>{caution}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {selected.notes && (
                    <>
                      <h3 className="text-[12px] font-medium text-text-muted mt-4 mb-1.5">メモ（社内向け）</h3>
                      <p className="m-0 whitespace-pre-wrap break-words">{selected.notes}</p>
                    </>
                  )}
                </aside>
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-[12px] leading-relaxed text-text-muted mt-4 mb-0">
        テンプレートと、そこから作る文書は、実務の目安です。法的な助言ではありません。株主総会・取締役会の書類や契約書は、発送・締結・登記の前に、専門家に確認してください。すでに争いのある相手に関する書面には、使えません。
      </p>

      <NewTemplateDialog
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
        onDraft={(next) => {
          setIsCreating(false);
          setDraft(next);
        }}
      />
      <TemplateEditor
        draft={draft}
        onClose={() => setDraft(null)}
        onSaved={(row) => {
          setCategory('all');
          setSelectedId(row.id);
          void reload();
        }}
      />
      <ComposeDialog isOpen={composing != null} template={composing} onClose={() => setComposing(null)} />
      <ConfirmDialog
        isOpen={toReview != null}
        destructive={false}
        title={toReview?.status === 'reviewed' ? '確認中に戻す' : '確認済みにする'}
        confirmLabel={toReview?.status === 'reviewed' ? '確認中に戻す' : '確認済みにする'}
        message={
          toReview?.status === 'reviewed' ? (
            <>「{toReview.title}」を「確認中」に戻します。</>
          ) : (
            <>
              「{toReview?.title}」の文面を確かめた、という印を付けます。法令上の記載事項と、会社の定款に合っているかを確かめてから付けてください。
              文面を変えると、「確認中」に戻ります。
            </>
          )
        }
        onCancel={() => setToReview(null)}
        onConfirm={toggleReviewed}
      />
      <ConfirmDialog
        isOpen={toDelete != null}
        title="テンプレートを削除"
        message={<>「{toDelete?.title}」を削除します。このテンプレートから作って持ち出した文書には、影響しません。元には戻せません。</>}
        onCancel={() => setToDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
};
