'use client';

// あるレコード（決算情報・お知らせなど）に付いた文書の一覧・追加・ダウンロード・削除。
// 文書の本体は文書ライブラリにあり、ここは entityType / entityId で絞って見せているだけ。

import React, { useState } from 'react';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { apiFetch } from '@/lib/resources/client';
import { DOCUMENT_VISIBILITIES } from '@/lib/resources/definitions';
import { optionLabel } from '@/lib/equity/types';
import { useDocuments } from '../hooks/useDocuments';
import { VISIBILITY_TONES, type LibraryDocument } from '../services/documents';
import { formatBytes } from '../services/format';
import { DocumentFormDialog, type DocumentFormDefaults } from './DocumentFormDialog.client';

export const EntityDocuments = ({
  entityType,
  entityId,
  canEdit,
  defaults,
  emptyText = '添付の文書はありません。',
  addLabel = '文書を追加',
  warnInternal = false,
  onChanged,
}: {
  entityType: 'financial_report' | 'shareholder_update' | 'meeting';
  entityId: string;
  canEdit: boolean;
  /** 追加するときの初期値（分類・公開範囲） */
  defaults?: Pick<DocumentFormDefaults, 'category' | 'visibility'>;
  emptyText?: string;
  addLabel?: string;
  /** 社内のみの文書に「株主には見えません」の注意を出す（親が株主に公開されているとき） */
  warnInternal?: boolean;
  /** 追加・削除のあと */
  onChanged?: () => void;
}) => {
  const documents = useDocuments(entityType, entityId);
  const [isAdding, setIsAdding] = useState(false);
  const [toDelete, setToDelete] = useState<LibraryDocument | null>(null);

  const reload = async () => {
    await documents.reload();
    onChanged?.();
  };

  const remove = async () => {
    if (!toDelete) return;
    await apiFetch(`/api/documents/${toDelete.id}`, { method: 'DELETE' });
    setToDelete(null);
    await reload();
  };

  const items = documents.data ?? [];

  return (
    <div>
      {documents.isLoading && !documents.data ? (
        <p className="text-[12.5px] text-text-muted m-0">読み込んでいます…</p>
      ) : documents.error ? (
        <p className="text-[12.5px] text-danger m-0">{documents.error}</p>
      ) : items.length === 0 ? (
        <p className="text-[12.5px] text-text-muted m-0">{emptyText}</p>
      ) : (
        <ul className="list-none p-0 m-0">
          {items.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b border-border last:border-b-0">
              {/* 幅の狭い枠（お知らせの「添付の文書」など）では、公開範囲とボタンをまとめて次の行に回し、題名の幅を確保する */}
              <div className="min-w-[min(100%,14rem)] flex-1">
                <div className="text-[13.5px] text-text-heading break-words">{document.title}</div>
                <div className="text-[12px] text-text-muted truncate" title={`${document.fileName}（${formatBytes(document.sizeBytes)}）`}>
                  {document.fileName}（{formatBytes(document.sizeBytes)}）
                </div>
                {warnInternal && document.visibility === 'internal' && (
                  <div className="text-[12px] text-warning mt-[2px]">
                    この文書は「社内のみ」のため、株主には表示されません。株主に見せるには、ライブラリの「共有」で公開範囲を変えてください。
                  </div>
                )}
              </div>
              <div className="flex items-center gap-x-3 shrink-0">
                <span className={`gt-pill gt-pill-sm ${VISIBILITY_TONES[document.visibility]}`}>{optionLabel(DOCUMENT_VISIBILITIES, document.visibility)}</span>
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
                {canEdit && (
                  <button type="button" className="gt-iconbtn" aria-label={`${document.title} を削除`} title="削除" onClick={() => setToDelete(document)}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <button type="button" className="gt-btn mt-3" style={{ height: '34px' }} onClick={() => setIsAdding(true)}>
          <Paperclip size={14} />
          {addLabel}
        </button>
      )}

      <DocumentFormDialog
        isOpen={isAdding}
        defaults={{ ...defaults, entityType, entityId }}
        title={addLabel}
        onClose={() => setIsAdding(false)}
        onSaved={() => void reload()}
      />
      <ConfirmDialog
        isOpen={toDelete != null}
        title="文書を削除"
        message={<>「{toDelete?.title}」を削除します。ファイルも削除され、発行済みの共有リンクも使えなくなります。元には戻せません。</>}
        onCancel={() => setToDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
};
