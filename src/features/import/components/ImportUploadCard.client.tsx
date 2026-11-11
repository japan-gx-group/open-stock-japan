'use client';

// 文書を選んで AI で読み取るカード。送る前に、送り先（提供元・モデル）と送る内容を確認のダイアログで見せる。
// ファイルは文書ライブラリ（社内のみ）に保存される。読取りに失敗しても文書は残り、種類を選び直してもう一度読み取れる。

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, RotateCcw, ScanText, X } from 'lucide-react';
import { NoticeList } from '@/components/resource/parts';
import { AiSendConfirmDialog } from '@/features/ai/components/AiSendConfirmDialog.client';
import { useAiStatus } from '@/features/ai/hooks/useAiStatus';
import { DOCUMENT_KINDS } from '@/lib/import/groups';
import { errorMessage } from '@/lib/resources/client';
import { AI_PROVIDER_LABELS } from '@/types/ai';
import { ExtractError, extractDocument, retryExtraction, type KindChoice } from '../services/importClient';
import { checkImportFile, formatFileSize, IMPORT_ACCEPT, MAX_AI_BYTES } from '../services/importFile';

const AUTO_DESCRIPTION = 'AI が先に文書の種類を判定してから読み取ります（AI への送信が 2 回になります）';

export const ImportUploadCard = ({ canUpload }: { canUpload: boolean }) => {
  const router = useRouter();
  const { status, isLoading } = useAiStatus();
  const [kind, setKind] = useState<KindChoice>('auto');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 読取りだけが失敗して、文書は保存済みのとき */
  const [stored, setStored] = useState<{ id: string; title: string; fileName: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isReady = Boolean(status?.configured && status.modelId);
  const isTooLarge = file != null && file.size > MAX_AI_BYTES;
  const description = kind === 'auto' ? AUTO_DESCRIPTION : (DOCUMENT_KINDS.find((item) => item.value === kind)?.description ?? '');

  const selectFile = (selected: File | null) => {
    setError(null);
    setStored(null);
    if (!selected) {
      setFile(null);
      return;
    }
    const problem = checkImportFile(selected);
    if (problem) {
      setError(problem);
      return;
    }
    setFile(selected);
  };

  const run = async (request: () => ReturnType<typeof extractDocument>) => {
    if (isSending) return;
    setIsSending(true);
    setError(null);
    try {
      const response = await request();
      router.push(`/import/${response.extraction.id}`);
    } catch (caught) {
      setIsConfirming(false);
      setError(errorMessage(caught, 'AI による読取りに失敗しました'));
      if (caught instanceof ExtractError && caught.storedDocument) {
        setStored(caught.storedDocument);
        setFile(null);
      }
      setIsSending(false);
    }
  };

  const send = () => {
    if (file) void run(() => extractDocument(file, kind, title));
  };
  const retry = () => {
    if (stored) void run(() => retryExtraction(stored.id, kind));
  };

  return (
    <section className="gt-card" aria-label="文書の読取り">
      <h2 className="gt-card-title m-0 flex items-center gap-2">
        <ScanText size={17} />
        文書を読み取る
      </h2>
      <p className="gt-card-sub mt-1 mb-0">
        契約書・登記事項証明書・議事録・決算書などの PDF や画像から、AI が台帳に入れる値を読み取ります。読み取った値は確認画面で確かめてから反映します。
      </p>

      {!canUpload ? (
        <p className="text-[13px] text-text-muted mt-4 mb-0">閲覧のみの権限では、文書の読取りと反映はできません（履歴は見られます）。</p>
      ) : isLoading ? (
        <p className="text-[13px] text-text-muted mt-4 mb-0">AI の設定を確認しています…</p>
      ) : !isReady ? (
        <div className="mt-4">
          <NoticeList
            items={[
              {
                level: 'info',
                message: (
                  <>
                    AI がまだ使えません。{status?.configured ? 'モデルが選ばれていません。' : '提供元の API キーが設定されていません。'}
                    管理者が{' '}
                    <Link href="/settings/company" className="text-primary underline underline-offset-2">
                      組織・メンバー設定
                    </Link>{' '}
                    の「AI の設定」で{status?.configured ? 'モデルを選ぶ' : '提供元の API キーとモデルを設定する'}と使えるようになります。
                  </>
                ),
              },
            ]}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="import-kind" className="gt-field-label">
                文書の種類
              </label>
              <select id="import-kind" className="gt-field gt-field-select w-full" value={kind} disabled={isSending} onChange={(event) => setKind(event.target.value as KindChoice)}>
                <option value="auto">自動判定</option>
                {DOCUMENT_KINDS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="text-[12.5px] text-text-muted mt-1.5 mb-0 leading-relaxed">{description}</p>
            </div>
            <div>
              <label htmlFor="import-title" className="gt-field-label">
                ライブラリでのタイトル（任意）
              </label>
              <input
                id="import-title"
                className="gt-field w-full"
                value={title}
                maxLength={200}
                disabled={isSending || stored != null}
                placeholder="空欄ならファイル名を使います"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          </div>

          {stored ? (
            <div className="rounded-md border border-border bg-primary-bg/40" style={{ padding: '12px 14px' }}>
              <p className="text-[13px] text-text-main m-0">
                「{stored.title}」（{stored.fileName}）はライブラリに保存済みです。文書の種類を選び直して、もう一度読み取れます（アップロードし直す必要はありません）。
              </p>
              <div className="flex gap-2 mt-3">
                <button type="button" className="gt-btn-primary" disabled={isSending} onClick={retry}>
                  {isSending ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                  {isSending ? '読み取り中…' : 'もう一度読み取る'}
                </button>
                <button type="button" className="gt-btn" disabled={isSending} onClick={() => setStored(null)}>
                  別のファイルを選ぶ
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className={`rounded-md border border-dashed text-center transition-colors ${isDragging ? 'border-primary bg-primary-bg' : 'border-border-strong'}`}
                style={{ padding: '22px 16px' }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  if (!isSending) selectFile(event.dataTransfer.files?.[0] ?? null);
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept={IMPORT_ACCEPT}
                  className="hidden"
                  aria-label="読み取るファイル"
                  onChange={(event) => {
                    selectFile(event.target.files?.[0] ?? null);
                    event.target.value = '';
                  }}
                />
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-[13.5px] text-text-heading">
                    <span className="break-all">
                      {file.name}
                      <span className="text-text-muted">（{formatFileSize(file.size)}）</span>
                    </span>
                    <button type="button" className="gt-iconbtn" aria-label="ファイルを外す" disabled={isSending} onClick={() => selectFile(null)}>
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-[13.5px] text-text-main m-0">ここにファイルをドラッグ＆ドロップ、または</p>
                    <button type="button" className="gt-btn mt-2" onClick={() => inputRef.current?.click()}>
                      <FileUp size={15} />
                      ファイルを選ぶ
                    </button>
                    <p className="text-[12px] text-text-muted mt-2 mb-0">PDF・画像（PNG・JPEG・WebP）・テキスト。AI に送れるのは 4MB まで（保存は 20MB まで）</p>
                  </>
                )}
              </div>
              {isTooLarge && (
                <NoticeList
                  items={[
                    {
                      level: 'warning',
                      message: 'このファイルは 4MB を超えているため、AI には送れません。ライブラリへの保存だけを行います。読み取るには、ページを分けるか画質を落として 4MB 以下にしてください。',
                    },
                  ]}
                />
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="gt-btn-primary" disabled={!file || isSending} onClick={() => (isTooLarge ? send() : setIsConfirming(true))}>
                  {isSending ? <Loader2 size={15} className="animate-spin" /> : <ScanText size={15} />}
                  {isSending ? '読み取り中…' : isTooLarge ? 'ライブラリに保存する（AI には送りません）' : 'AI で読み取る'}
                </button>
                <span className="text-[12.5px] text-text-muted">
                  送信先: {status?.provider ? AI_PROVIDER_LABELS[status.provider] : ''}（{status?.modelId}）。読取りには 10〜60 秒ほどかかります。
                </span>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-[13px] text-danger m-0">
              {error}
            </p>
          )}
        </div>
      )}

      <AiSendConfirmDialog
        isOpen={isConfirming}
        purposeLabel="文書からの読取り"
        provider={status?.provider ?? null}
        modelId={status?.modelId ?? null}
        items={file ? [{ name: file.name, note: formatFileSize(file.size) }] : []}
        isSending={isSending}
        onCancel={() => setIsConfirming(false)}
        onConfirm={send}
        storageNote="ファイルはこのアプリの文書ライブラリ（社内のみ）に保存し、読み取った結果も確認用に保存します。AI の提供元には、保存しない設定で送ります。"
      />
    </section>
  );
};
