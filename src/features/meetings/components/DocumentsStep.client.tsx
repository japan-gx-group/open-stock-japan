'use client';

// 手順 6: 会議に関連づけた文書（招集通知の控え・同意書・署名済みの議事録など）。
// 一覧: GET /api/documents?entityType=meeting&entityId=…、アップロード: POST /api/documents（管理者・メンバー）。

import React, { useCallback, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { formatDateJa } from '@/lib/equity/format';
import { apiFetch, errorMessage } from '@/lib/resources/client';
import type { MeetingDocument, MeetingRow } from '../types';

const MAX_BYTES = 20 * 1024 * 1024;

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const useMeetingDocuments = (meetingId: string) => {
  const load = useCallback(
    async () =>
      (await apiFetch<{ items: MeetingDocument[] }>(`/api/documents?entityType=meeting&entityId=${encodeURIComponent(meetingId)}`)).items,
    [meetingId],
  );
  return useAsyncData(load);
};

export const DocumentsStep = ({
  meeting,
  documents,
  error: loadError,
  editable,
  onChanged,
}: {
  meeting: MeetingRow;
  documents: MeetingDocument[];
  error: string | null;
  editable: boolean;
  onChanged: () => Promise<void>;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | null) => {
    if (!file || isUploading) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('ファイルは 20MB までです');
      return;
    }
    setIsUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('category', 'meeting');
      form.set('visibility', 'internal');
      form.set('entityType', 'meeting');
      form.set('entityId', meeting.id);
      if (meeting.heldOn) form.set('documentDate', meeting.heldOn);
      await apiFetch('/api/documents', { method: 'POST', body: form });
      await onChanged();
    } catch (caught) {
      setError(errorMessage(caught, 'アップロードに失敗しました'));
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {loadError && (
        <p role="alert" className="text-[13px] text-danger m-0">
          {loadError}
        </p>
      )}
      {documents.length === 0 ? (
        <p className="text-[13px] text-text-muted m-0">
          関連づけた文書はありません。発送した招集通知の控え、委任状・同意書、署名・押印済みの議事録などを保存しておけます。
        </p>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-text-heading truncate">{document.title || document.fileName}</div>
                <div className="text-[12px] text-text-muted truncate">
                  {document.fileName}・{formatSize(document.sizeBytes)}・{formatDateJa(document.createdAt)} 登録
                </div>
              </div>
              <a className="gt-btn h-8 px-2 text-[12px] shrink-0" href={`/api/documents/${document.id}/download`} target="_blank" rel="noopener noreferrer">
                <Download size={14} />
                ダウンロード
              </a>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger m-0">
          {error}
        </p>
      )}
      {editable && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            aria-label="会議に関連づける文書"
            onChange={(event) => void upload(event.target.files?.[0] ?? null)}
          />
          <button type="button" className="gt-btn" onClick={() => inputRef.current?.click()} disabled={isUploading}>
            <Upload size={15} />
            {isUploading ? 'アップロード中…' : '文書をアップロード'}
          </button>
          <span className="text-[12px] text-text-muted">PDF・画像・Word・Excel など（20MB まで）。区分は「株主総会・取締役会」、公開範囲は社内のみで保存します。</span>
        </div>
      )}
    </div>
  );
};
