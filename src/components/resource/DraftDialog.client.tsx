'use client';

// AI による文章の下書き（招集通知・議事録・お知らせなど）。材料（context）は呼び出し側が組み立てて渡す。
// 作った下書きは編集してから「この内容を使う」で呼び出し側に返す（保存は呼び出し側）。

import React, { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { useAiStatus } from '@/features/ai/hooks/useAiStatus';
import { errorMessage, requestDraft } from '@/lib/resources/client';
import { AI_PROVIDER_LABELS } from '@/types/ai';

export type DraftKind =
  | 'shareholder_meeting_notice'
  | 'shareholder_meeting_minutes'
  | 'shareholder_written_resolution'
  | 'board_meeting_notice'
  | 'board_meeting_minutes'
  | 'board_written_resolution'
  | 'shareholder_update'
  | 'financial_highlights';

const Body = ({
  kind,
  context,
  initialBody,
  useLabel,
  onUse,
  onClose,
}: {
  kind: DraftKind;
  context: string;
  initialBody: string;
  useLabel: string;
  onUse: (body: string) => void | Promise<void>;
  onClose: () => void;
}) => {
  const { status, isLoading } = useAiStatus();
  const [body, setBody] = useState(initialBody);
  const [request, setRequest] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isReady = Boolean(status?.configured && status.modelId);

  const draft = async () => {
    if (isDrafting) return;
    setIsDrafting(true);
    setError(null);
    try {
      const result = await requestDraft(kind, context, request);
      setBody(result.body);
      setNotes(result.notes);
    } catch (caught) {
      setError(errorMessage(caught, '下書きの作成に失敗しました'));
    } finally {
      setIsDrafting(false);
    }
  };

  const use = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onUse(body);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, '保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="rounded-md border border-border bg-primary-bg/40 px-4 py-3 mb-4">
        {isLoading ? (
          <p className="text-[13px] text-text-muted m-0">AI の設定を確認しています…</p>
        ) : !isReady ? (
          <p className="text-[13px] text-text-muted m-0">
            AI が未設定のため下書きの自動作成は使えません（組織・メンバー設定 &gt; AI の設定）。下の欄に直接入力できます。
          </p>
        ) : (
          <>
            <label htmlFor="draft-request" className="gt-field-label">
              AI への要望（任意）
            </label>
            <div className="flex gap-2">
              <input
                id="draft-request"
                className="gt-field flex-1"
                value={request}
                maxLength={2000}
                placeholder="例: 第2号議案の提案理由を詳しく / 簡潔に"
                onChange={(event) => setRequest(event.target.value)}
              />
              <Button type="button" onClick={draft} disabled={isDrafting}>
                {isDrafting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {isDrafting ? '作成中…' : body.trim() ? '作り直す' : '下書きを作る'}
              </Button>
            </div>
            <p className="text-[12px] text-text-muted mt-2 mb-0">
              登録済みの内容（日時・議案・出席者など）を {status?.provider ? AI_PROVIDER_LABELS[status.provider] : 'AI の提供元'}（{status?.modelId}）に送って下書きを作ります。
              「【要確認】」と書かれた箇所と法令上の記載事項は、必ず自分で確かめてください。
            </p>
          </>
        )}
      </div>

      {notes.length > 0 && (
        <ul className="text-[13px] text-text-muted mt-0 mb-3 pl-5">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <textarea
        className="gt-field w-full"
        style={{ minHeight: '340px', height: 'auto', padding: '11px 13px', lineHeight: 1.7 }}
        aria-label="本文"
        value={body}
        maxLength={60000}
        onChange={(event) => setBody(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-[13px] text-danger mt-3 mb-0">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          キャンセル
        </Button>
        <Button type="button" onClick={use} disabled={isSaving || isDrafting}>
          {isSaving && <Loader2 className="animate-spin" />}
          {useLabel}
        </Button>
      </div>
    </>
  );
};

export const DraftDialog = ({
  isOpen,
  title,
  kind,
  context,
  initialBody = '',
  useLabel = 'この内容を保存',
  onUse,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  kind: DraftKind;
  /** AI に渡す材料（会議の日時・議案・出席者、決算の数字など）を文章にしたもの */
  context: string;
  initialBody?: string;
  useLabel?: string;
  /** 編集後の本文を受け取って保存する。失敗したら例外を投げる */
  onUse: (body: string) => void | Promise<void>;
  onClose: () => void;
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
    {isOpen && <Body kind={kind} context={context} initialBody={initialBody} useLabel={useLabel} onUse={onUse} onClose={onClose} />}
  </Modal>
);
