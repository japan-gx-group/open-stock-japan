'use client';

// 決算情報（社内向け）。決算の数字の登録・推移のグラフ・前年同期比・ハイライト・株主ポータルへの公開・関連する文書。
// 一覧は社内の全員、登録・編集・公開の切り替えは管理者とメンバー（API が確かめる）。

import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { DraftDialog } from '@/components/resource/DraftDialog.client';
import { EmptyState, ErrorBlock, LegalBasis, LoadingBlock } from '@/components/resource/parts';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { EntityDocuments } from '@/features/library/components/EntityDocuments.client';
import { isoToTokyoDate } from '@/features/library/services/format';
import { useCompany } from '@/hooks/useCompany';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useResourceList } from '@/hooks/useResourceList';
import { formatDateJa, formatYen } from '@/lib/equity/format';
import { optionLabel } from '@/lib/equity/types';
import { deleteItem, saveItem } from '@/lib/resources/client';
import { FINANCIAL_PERIOD_TYPES, FINANCIAL_STATUSES } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';
import { canEdit } from '@/types/role';
import {
  annualSeries,
  buildHighlightsContext,
  FIGURE_KEYS,
  FIGURE_LABELS,
  findPreviousComparable,
  formatChange,
  formatCompactYen,
  formatPeriod,
  toFigures,
  yearOverYear,
  type FinancialFigures,
} from '../services/analysis';
import { buildLegalNotes } from '../services/legalNotes';
import { fullRowPayload } from '../services/payload';
import { FinancialCharts } from './FinancialCharts.client';

// 株主への公開は、確認ダイアログを通す専用の操作で切り替える（登録・編集のフォームには出さない）
const PUBLISH_KEYS = ['isPublishedToShareholders'] as const;

const PublishedPill = ({ row }: { row: ResourceRow }) =>
  row.isPublishedToShareholders === true ? (
    <span className="gt-pill gt-pill-sm gt-pill-good">株主に公開中</span>
  ) : (
    <span className="gt-pill gt-pill-sm gt-pill-neutral">非公開</span>
  );

const StatusPill = ({ status }: { status: unknown }) => (
  <span className={`gt-pill gt-pill-sm ${status === 'approved' ? 'gt-pill-accent' : 'gt-pill-warn'}`}>
    {optionLabel(FINANCIAL_STATUSES, String(status ?? ''))}
  </span>
);

const amountClass = (value: number | null): string => (value != null && value < 0 ? 'gt-num text-danger' : 'gt-num');

const Detail = ({
  row,
  figures,
  previous,
  editable,
  onEdit,
  onDelete,
  onDraft,
  onTogglePublish,
}: {
  row: ResourceRow;
  figures: FinancialFigures;
  previous: FinancialFigures | null;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDraft: () => void;
  onTogglePublish: () => void;
}) => {
  const { governance } = useCompany();
  const meetings = useResourceList('meetings');
  const yoy = yearOverYear(figures, previous);
  const isPublished = row.isPublishedToShareholders === true;
  const meeting = (meetings.data ?? []).find((item) => item.id === row.approvedMeetingId);
  const meetingOn = typeof meeting?.heldOn === 'string' ? meeting.heldOn : null;
  const isAnnual = figures.periodType === 'annual';
  const notes = buildLegalNotes(isAnnual ? figures.periodEnd : null, governance, meetingOn);
  const highlights = String(row.highlights ?? '');

  return (
    <div className="gt-card mt-4">
      <div className="gt-card-head">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="gt-card-title m-0">{figures.title}</h2>
            <span className="gt-pill gt-pill-sm gt-pill-neutral">{optionLabel(FINANCIAL_PERIOD_TYPES, figures.periodType)}</span>
            <StatusPill status={row.status} />
            <PublishedPill row={row} />
          </div>
          <div className="gt-card-sub">
            {formatDateJa(figures.periodStart)}〜{formatDateJa(figures.periodEnd)}
            {meeting && `・承認: ${String(meeting.title ?? '')}${meetingOn ? `（${formatDateJa(meetingOn)}）` : ''}`}
            {isPublished && typeof row.publishedAt === 'string' && `・公開日: ${formatDateJa(isoToTokyoDate(row.publishedAt))}`}
          </div>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            <button type="button" className="gt-btn" onClick={onTogglePublish}>
              {isPublished ? <EyeOff size={14} /> : <Eye size={14} />}
              {isPublished ? '公開をやめる' : '株主に公開'}
            </button>
            <button type="button" className="gt-btn" onClick={onEdit}>
              <Pencil size={14} />
              編集
            </button>
            <button type="button" className="gt-iconbtn" aria-label={`${figures.title} を削除`} title="削除" onClick={onDelete}>
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
        <section className="min-w-0">
          <h3 className="text-[13px] font-semibold text-text-heading mt-0 mb-1">
            数字と前年同期比
            <span className="font-normal text-text-muted ml-2 text-[12px]">
              {previous ? `比較: ${previous.title}（${formatPeriod(previous.periodStart, previous.periodEnd)}）` : '前年の同じ期間の登録がないため、比較は表示されません'}
            </span>
          </h3>
          <div className="gt-table-scroll">
            <table className="gt-table">
              <thead>
                <tr>
                  <th>項目</th>
                  <th className="gt-num">今回</th>
                  <th className="gt-num">前年同期</th>
                  <th className="gt-num">増減</th>
                </tr>
              </thead>
              <tbody>
                {FIGURE_KEYS.map((key) => {
                  const change = yoy[key];
                  const isPeople = key === 'employees';
                  const show = (value: number | null) => (value == null ? '—' : isPeople ? `${value.toLocaleString('ja-JP')}人` : formatYen(value));
                  return (
                    <tr key={key}>
                      <td>{FIGURE_LABELS[key]}</td>
                      <td className={amountClass(change.current)}>{show(change.current)}</td>
                      <td className="gt-num text-text-muted">{show(change.previous)}</td>
                      <td className="gt-num">{formatChange(change, isPeople ? 'people' : 'yen')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-text-muted mt-2 mb-0">
            増減は、前年同期の値が正のときは率、0 以下のとき（損失など）は金額の差で表示します。
          </p>
        </section>

        <div className="flex flex-col gap-5 min-w-0">
          <section>
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="text-[13px] font-semibold text-text-heading m-0">ハイライト・コメント</h3>
              {editable && (
                <button type="button" className="gt-btn" style={{ height: '32px' }} onClick={onDraft}>
                  <Sparkles size={14} />
                  ハイライトを AI で下書き
                </button>
              )}
            </div>
            {highlights ? (
              <p className="text-[13.5px] leading-[1.8] text-text-body whitespace-pre-wrap break-words m-0">{highlights}</p>
            ) : (
              <p className="text-[12.5px] text-text-muted m-0">
                まだありません。株主に伝える要点（事業の進捗・増減の理由など）を書くと、株主ポータルの決算情報に表示されます。
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[13px] font-semibold text-text-heading mt-0 mb-1">関連する文書（計算書類・事業報告など）</h3>
            <EntityDocuments
              entityType="financial_report"
              entityId={row.id}
              canEdit={editable}
              defaults={{ category: 'financial', visibility: 'internal' }}
              emptyText="この決算に関連づけた文書はありません。"
              warnInternal={isPublished}
            />
          </section>
        </div>
      </div>

      <section className="mt-5 rounded-md border border-border bg-primary-bg/40 px-4 py-3">
        <h3 className="text-[13px] font-semibold text-text-heading mt-0 mb-2">
          決算の手続きの覚え書き
          {!isAnnual && <span className="font-normal text-text-muted ml-2 text-[12px]">（通期の決算で期限を計算します）</span>}
        </h3>
        <ul className="list-none p-0 m-0 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          {notes.map((note) => (
            <li key={note.key} className="text-[12.5px] leading-relaxed text-text-body">
              <div className="font-semibold text-text-heading">
                {note.title}
                {note.date && note.dateLabel && (
                  <span className="font-normal ml-2">
                    {note.dateLabel}: <span className="font-semibold tabular-nums">{formatDateJa(note.date)}</span>
                  </span>
                )}
              </div>
              {note.body} <LegalBasis>{note.basis}</LegalBasis>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-text-muted mt-3 mb-0">
          日付は登録内容からの計算上の目安です。定款の定めや個別の事情で変わるため、司法書士・税理士などの専門家に確認してください。
        </p>
      </section>
    </div>
  );
};

export const Financials = () => {
  const { role, profile } = useCurrentUser();
  const editable = canEdit(role);
  const reports = useResourceList('financial-reports');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<ResourceRow | null>(null);
  const [toDelete, setToDelete] = useState<ResourceRow | null>(null);
  const [drafting, setDrafting] = useState<ResourceRow | null>(null);
  const [toToggle, setToToggle] = useState<ResourceRow | null>(null);

  const rows = useMemo(() => reports.data ?? [], [reports.data]);
  const figuresList = useMemo(() => rows.map(toFigures), [rows]);
  const figuresById = useMemo(() => new Map(figuresList.map((figures) => [figures.id, figures])), [figuresList]);
  const series = useMemo(() => annualSeries(figuresList), [figuresList]);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const selectedFigures = selected ? (figuresById.get(selected.id) ?? null) : null;

  const reload = () => reports.reload();

  const remove = async () => {
    if (!toDelete) return;
    await deleteItem('financial-reports', toDelete.id);
    setToDelete(null);
    await reload();
  };

  const togglePublish = async () => {
    if (!toToggle) return;
    await saveItem(
      'financial-reports',
      fullRowPayload('financial-reports', toToggle, { isPublishedToShareholders: toToggle.isPublishedToShareholders !== true }),
      toToggle.id,
    );
    setToToggle(null);
    await reload();
  };

  const saveHighlights = async (row: ResourceRow, body: string) => {
    await saveItem('financial-reports', fullRowPayload('financial-reports', row, { highlights: body.trim() }), row.id);
    await reload();
  };

  const draftingFigures = drafting ? (figuresById.get(drafting.id) ?? null) : null;
  const addButton = editable ? (
    <button type="button" className="gt-btn-primary" onClick={() => setIsCreating(true)}>
      <Plus size={15} />
      決算情報を登録
    </button>
  ) : null;

  return (
    <div className="page-body">
      <PageHeading
        title="決算情報"
        description="決算の数字と推移を記録し、株主ポータルへの公開を管理します"
        primaryAction={addButton}
      />

      {reports.isLoading && !reports.data ? (
        <LoadingBlock />
      ) : reports.error && !reports.data ? (
        <ErrorBlock message={reports.error} onRetry={() => void reload()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="決算情報はまだありません"
          description="期ごとの売上高・利益・純資産などを登録すると、推移のグラフと前年同期比が表示され、株主ポータルに公開できます。登録の画面で決算書の PDF を AI に読み取らせることもできます。"
          action={addButton ?? undefined}
        />
      ) : (
        <>
          {series.length > 0 && <FinancialCharts points={series} />}

          <div className="gt-card gt-card-table mt-4">
            <div className="gt-table-scroll">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th>名称・期間</th>
                    <th>種類</th>
                    <th>状態</th>
                    <th className="gt-num">売上高</th>
                    <th className="gt-num">営業利益</th>
                    <th className="gt-num">当期純利益</th>
                    <th className="gt-num">現金及び預金</th>
                    <th className="gt-num">純資産</th>
                    <th>株主への公開</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const figures = figuresById.get(row.id);
                    if (!figures) return null;
                    const isSelected = selected?.id === row.id;
                    return (
                      <tr key={row.id} className={isSelected ? 'bg-primary-bg/50' : undefined}>
                        <td className="gt-wrap-sm">
                          <button
                            type="button"
                            className="text-left font-medium text-primary hover:underline bg-transparent border-0 p-0 cursor-pointer"
                            aria-pressed={isSelected}
                            onClick={() => setSelectedId(row.id)}
                          >
                            {figures.title}
                          </button>
                          <div className="text-[11.5px] text-text-muted whitespace-nowrap">{formatPeriod(figures.periodStart, figures.periodEnd)}</div>
                        </td>
                        <td>{optionLabel(FINANCIAL_PERIOD_TYPES, figures.periodType)}</td>
                        <td>
                          <StatusPill status={row.status} />
                        </td>
                        <td className={amountClass(figures.revenue)}>{formatCompactYen(figures.revenue)}</td>
                        <td className={amountClass(figures.operatingIncome)}>{formatCompactYen(figures.operatingIncome)}</td>
                        <td className={amountClass(figures.netIncome)}>{formatCompactYen(figures.netIncome)}</td>
                        <td className={amountClass(figures.cashAndDeposits)}>{formatCompactYen(figures.cashAndDeposits)}</td>
                        <td className={amountClass(figures.netAssets)}>{formatCompactYen(figures.netAssets)}</td>
                        <td>
                          <PublishedPill row={row} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selected && selectedFigures && (
            <Detail
              key={selected.id}
              row={selected}
              figures={selectedFigures}
              previous={findPreviousComparable(selectedFigures, figuresList)}
              editable={editable}
              onEdit={() => setEditing(selected)}
              onDelete={() => setToDelete(selected)}
              onDraft={() => setDrafting(selected)}
              onTogglePublish={() => setToToggle(selected)}
            />
          )}
        </>
      )}

      <ResourceFormDialog
        resource="financial-reports"
        isOpen={isCreating}
        hiddenKeys={PUBLISH_KEYS}
        onClose={() => setIsCreating(false)}
        onSaved={(row) => {
          setSelectedId(row.id);
          void reload();
        }}
      />
      <ResourceFormDialog
        resource="financial-reports"
        isOpen={editing != null}
        initial={editing}
        hiddenKeys={PUBLISH_KEYS}
        onClose={() => setEditing(null)}
        onSaved={() => void reload()}
      />
      <DraftDialog
        isOpen={drafting != null && draftingFigures != null}
        title={`ハイライトの下書き: ${draftingFigures?.title ?? ''}`}
        kind="financial_highlights"
        context={
          draftingFigures
            ? buildHighlightsContext(draftingFigures, findPreviousComparable(draftingFigures, figuresList), profile?.organizationName ?? '')
            : ''
        }
        initialBody={String(drafting?.highlights ?? '')}
        useLabel="ハイライトとして保存"
        onUse={async (body) => {
          if (drafting) await saveHighlights(drafting, body);
        }}
        onClose={() => setDrafting(null)}
      />
      <ConfirmDialog
        isOpen={toToggle != null}
        destructive={false}
        title={toToggle?.isPublishedToShareholders === true ? '株主への公開をやめる' : '株主ポータルに公開'}
        confirmLabel={toToggle?.isPublishedToShareholders === true ? '公開をやめる' : '公開する'}
        message={
          toToggle?.isPublishedToShareholders === true ? (
            <>「{String(toToggle?.title ?? '')}」を株主ポータルから取り下げます。株主はこの決算の数字とハイライトを見られなくなります。</>
          ) : (
            <>
              「{String(toToggle?.title ?? '')}」を株主ポータルに公開します。
              株主ポータルのアカウントを持つ<strong>すべての株主</strong>が、この決算の数字（売上高・利益・純資産・現金及び預金・有利子負債・従業員数）とハイライトを見られるようになります。
              関連する文書は、公開範囲が「全株主に公開」または本人あてのものだけが表示されます。
              {toToggle?.status !== 'approved' && (
                <span className="block mt-2 text-warning">状態が「作成中」のため、株主には「速報（承認前）」と表示されます。</span>
              )}
            </>
          )
        }
        onCancel={() => setToToggle(null)}
        onConfirm={togglePublish}
      />
      <ConfirmDialog
        isOpen={toDelete != null}
        title="決算情報を削除"
        message={
          <>
            「{String(toDelete?.title ?? '')}」を削除します。
            {toDelete?.isPublishedToShareholders === true && '株主ポータルからも見えなくなります。'}
            関連する文書は削除されず、ライブラリに残ります。元には戻せません。
          </>
        }
        onCancel={() => setToDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
};
