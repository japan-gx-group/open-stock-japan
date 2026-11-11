'use client';

// 文書ライブラリ。定款・契約書・議事録・決算書などのファイルを分類して保管し、株主への公開範囲と共有リンクを管理する。
// 一覧・ダウンロードは社内の全員、登録・編集・削除・共有は管理者とメンバー（API が確かめる）。

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Pencil, Share2, Trash2, Upload } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/resource/parts';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useResourceList } from '@/hooks/useResourceList';
import { formatDateJa } from '@/lib/equity/format';
import { optionLabel } from '@/lib/equity/types';
import { apiFetch } from '@/lib/resources/client';
import { DOCUMENT_CATEGORIES, DOCUMENT_VISIBILITIES } from '@/lib/resources/definitions';
import { canEdit } from '@/types/role';
import { useDocuments } from '../hooks/useDocuments';
import { describeEntity, filterDocuments, VISIBILITY_TONES, type EntityTitles, type LibraryDocument } from '../services/documents';
import { formatBytes, isoToTokyoDate } from '../services/format';
import { DocumentFormDialog } from './DocumentFormDialog.client';
import { ShareDialog } from './ShareDialog.client';

export const Library = () => {
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  const documents = useDocuments();
  const meetings = useResourceList('meetings');
  const reports = useResourceList('financial-reports');
  const updates = useResourceList('shareholder-updates');

  const [filters, setFilters] = useState({ category: '', visibility: '', search: '' });
  const [isUploading, setIsUploading] = useState(false);
  const [editing, setEditing] = useState<LibraryDocument | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LibraryDocument | null>(null);

  const titles: EntityTitles = useMemo(
    () => ({
      meetings: new Map((meetings.data ?? []).map((row) => [row.id, { title: String(row.title ?? ''), meetingType: String(row.meetingType ?? '') }])),
      financialReports: new Map((reports.data ?? []).map((row) => [row.id, String(row.title ?? '')])),
      updates: new Map((updates.data ?? []).map((row) => [row.id, String(row.title ?? '')])),
    }),
    [meetings.data, reports.data, updates.data],
  );

  const all = useMemo(() => documents.data ?? [], [documents.data]);
  const visible = useMemo(() => filterDocuments(all, filters), [all, filters]);
  const sharing = sharingId ? (all.find((document) => document.id === sharingId) ?? null) : null;
  const isFiltered = Boolean(filters.category || filters.visibility || filters.search.trim());

  const remove = async () => {
    if (!toDelete) return;
    await apiFetch(`/api/documents/${toDelete.id}`, { method: 'DELETE' });
    setToDelete(null);
    await documents.reload();
  };

  return (
    <div className="page-body">
      <PageHeading
        title="ライブラリ"
        description="定款・契約書・議事録・決算書などの文書を保管し、株主への公開範囲と共有リンクを管理します"
        primaryAction={
          editable ? (
            <button type="button" className="gt-btn-primary" onClick={() => setIsUploading(true)}>
              <Upload size={15} />
              文書をアップロード
            </button>
          ) : null
        }
      />

      <div className="gt-filter-bar" style={{ marginTop: 0 }}>
        <div className="gt-filter-field">
          <label htmlFor="library-category" className="gt-field-label">
            分類
          </label>
          <select
            id="library-category"
            className="gt-field gt-field-select w-full"
            value={filters.category}
            onChange={(event) => setFilters({ ...filters, category: event.target.value })}
          >
            <option value="">すべて</option>
            {DOCUMENT_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="gt-filter-field">
          <label htmlFor="library-visibility" className="gt-field-label">
            公開範囲
          </label>
          <select
            id="library-visibility"
            className="gt-field gt-field-select w-full"
            value={filters.visibility}
            onChange={(event) => setFilters({ ...filters, visibility: event.target.value })}
          >
            <option value="">すべて</option>
            {DOCUMENT_VISIBILITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="gt-filter-field gt-filter-field-grow">
          <label htmlFor="library-search" className="gt-field-label">
            キーワード
          </label>
          <input
            id="library-search"
            type="search"
            className="gt-field w-full"
            placeholder="タイトル・ファイル名・説明"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </div>
      </div>

      <div className="mt-4">
        {documents.isLoading && !documents.data ? (
          <LoadingBlock />
        ) : documents.error && !documents.data ? (
          <ErrorBlock message={documents.error} onRetry={() => void documents.reload()} />
        ) : all.length === 0 ? (
          <EmptyState
            title="文書はまだありません"
            description="定款、登記事項証明書、投資契約書、株主総会議事録、決算書などをアップロードすると、ここで一元管理できます。公開範囲は文書ごとに決められ、初期値は「社内のみ」です。"
            action={
              editable ? (
                <button type="button" className="gt-btn-primary" onClick={() => setIsUploading(true)}>
                  <Upload size={15} />
                  文書をアップロード
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="gt-card gt-card-table">
            <div className="text-[12.5px] text-text-muted mb-1">
              {isFiltered ? `${visible.length} 件（全 ${all.length} 件）` : `${all.length} 件`}
            </div>
            <div className="gt-table-scroll">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th>タイトル</th>
                    <th title="上の行が分類、下の行が関連するレコード（会議・決算情報・お知らせ）">分類・関連</th>
                    <th>公開範囲</th>
                    <th title="上の行が文書の日付、下の行がライブラリに登録した日">文書の日付・登録日</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="gt-table-empty">
                        条件に合う文書がありません。
                      </td>
                    </tr>
                  ) : (
                    visible.map((document) => {
                      const entity = describeEntity(document, titles);
                      return (
                        <tr key={document.id}>
                          <td className="gt-wrap">
                            <div className="font-medium break-words">{document.title}</div>
                            {/* ファイル名は列を広げない（入りきらない分は … で切り、全文は title で読める） */}
                            <div className="gt-cell-clip text-[11.5px] text-text-muted" title={`${document.fileName}（${formatBytes(document.sizeBytes)}）`}>
                              {document.fileName}（{formatBytes(document.sizeBytes)}）
                            </div>
                            {document.description && (
                              <div className="text-[12px] text-text-body mt-[2px] line-clamp-2 whitespace-pre-wrap break-words">{document.description}</div>
                            )}
                          </td>
                          {/* 分類の名前は割らない。関連するレコードの名前は、分類の幅の中で折り返す */}
                          <td className="gt-wrap-sm">
                            <div className="whitespace-nowrap">{optionLabel(DOCUMENT_CATEGORIES, document.category)}</div>
                            {entity && (
                              <Link href={entity.path} className="block text-[11.5px] text-primary no-underline hover:underline break-words">
                                {entity.label}
                              </Link>
                            )}
                          </td>
                          <td>
                            <span className={`gt-pill gt-pill-sm ${VISIBILITY_TONES[document.visibility]}`}>
                              {optionLabel(DOCUMENT_VISIBILITIES, document.visibility)}
                            </span>
                          </td>
                          <td>
                            {formatDateJa(document.documentDate)}
                            <div className="text-[11.5px] text-text-muted">登録 {formatDateJa(isoToTokyoDate(document.createdAt))}</div>
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-1">
                              <a
                                href={`/api/documents/${document.id}/download`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="gt-iconbtn"
                                aria-label={`${document.title} をダウンロード`}
                                title="ダウンロード"
                              >
                                <Download size={15} />
                              </a>
                              {editable && (
                                <>
                                  <button type="button" className="gt-btn" style={{ height: '32px', padding: '0 10px' }} onClick={() => setSharingId(document.id)}>
                                    <Share2 size={14} />
                                    共有
                                  </button>
                                  <button type="button" className="gt-iconbtn" aria-label={`${document.title} を編集`} title="編集" onClick={() => setEditing(document)}>
                                    <Pencil size={15} />
                                  </button>
                                  <button type="button" className="gt-iconbtn" aria-label={`${document.title} を削除`} title="削除" onClick={() => setToDelete(document)}>
                                    <Trash2 size={15} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <DocumentFormDialog isOpen={isUploading} onClose={() => setIsUploading(false)} onSaved={() => void documents.reload()} />
      <DocumentFormDialog isOpen={editing != null} initial={editing} onClose={() => setEditing(null)} onSaved={() => void documents.reload()} />
      <ShareDialog document={sharing} onClose={() => setSharingId(null)} onChanged={() => void documents.reload()} />
      <ConfirmDialog
        isOpen={toDelete != null}
        title="文書を削除"
        message={
          <>
            「{toDelete?.title}」を削除します。ファイルも削除され、株主ポータルからも見えなくなり、発行済みの共有リンクも使えなくなります。元には戻せません。
          </>
        }
        onCancel={() => setToDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
};
