'use client';

// 手順 4: 招集通知（書面決議では提案書・同意書）。文面は DB に保存しない（コピーまたは .txt で持ち出す）。

import React, { useState } from 'react';
import { Check, Copy, Download, FileText, Sparkles } from 'lucide-react';
import { DraftDialog } from '@/components/resource/DraftDialog.client';
import { LegalBasis } from '@/components/resource/parts';
import { ComposeDialog } from '@/features/templates/components/ComposeDialog.client';
import { meetingKindsFor } from '@/features/templates/services/kinds';
import { formatDateJa, todayInTokyo } from '@/lib/equity/format';
import { errorMessage } from '@/lib/resources/client';
import { draftKindFor, isWrittenResolution, type NoticeInfo } from '../services/meetingRules';
import type { MeetingKind, MeetingRow } from '../types';

/** ファイル名に使えない文字を除く */
const safeFileName = (value: string): string => value.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'document';

export const NoticeStep = ({
  meeting,
  kind,
  notice,
  context,
  editable,
  onUpdateMeeting,
}: {
  meeting: MeetingRow;
  kind: MeetingKind;
  notice: NoticeInfo;
  /** AI に渡す材料（開くたびに最新の内容で組み立てる） */
  context: () => string;
  editable: boolean;
  onUpdateMeeting: (overrides: Record<string, unknown>) => Promise<void>;
}) => {
  const written = isWrittenResolution(meeting);
  const documentName = written ? '提案書・同意書' : '招集通知';
  const [body, setBody] = useState('');
  const [draftContext, setDraftContext] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const today = todayInTokyo();

  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('クリップボードにコピーできませんでした。文面を選択してコピーしてください。');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFileName(`${meeting.title}_${documentName}`)}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const setSentOn = async (value: string | null) => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onUpdateMeeting({
        noticeSentOn: value,
        // 準備中なら「招集通知済み」に進める（開催済み・議事録確定は変えない）
        ...(value && meeting.status === 'planning' ? { status: 'noticed' } : {}),
      });
    } catch (caught) {
      setError(errorMessage(caught, '保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[13px] leading-relaxed text-text-body">
        {written ? (
          <>
            書面決議では招集通知は発しません。提案の内容を{kind === 'board' ? '取締役' : '株主'}の全員に示し、書面または電磁的記録で同意を集めます
            <LegalBasis>{kind === 'board' ? '会社法370条' : '会社法319条1項'}</LegalBasis>。
          </>
        ) : (
          <>
            発送の期限: <strong className="inline-block">{notice.deadline ? formatDateJa(notice.deadline) : '開催日を入力すると計算します'}</strong>（会日の{' '}
            <span className="whitespace-nowrap">{notice.rule.days} 日前まで</span>
            {notice.rule.note ? `。${notice.rule.note}` : ''}）<LegalBasis>{notice.rule.basis}</LegalBasis>
            <span className="ml-2 inline-block">
              発送日: <strong>{meeting.noticeSentOn ? formatDateJa(meeting.noticeSentOn) : '未記録'}</strong>
            </span>
            {kind === 'shareholder' && (
              <div className="text-[12px] text-text-muted mt-1">
                電磁的方法（メールなど）で通知するには、株主ごとの承諾が必要です（会社法299条3項）。取締役会設置会社の定時株主総会では、招集通知に際して計算書類・事業報告を提供します（会社法437条）。
              </div>
            )}
          </>
        )}
      </div>

      {body ? (
        <>
          <pre className="m-0 max-h-[420px] overflow-auto rounded-md border border-border bg-bg-subtle px-4 py-3 text-[13px] leading-[1.8] whitespace-pre-wrap font-sans text-text-main">
            {body}
          </pre>
          <p className="text-[12px] text-text-muted m-0">
            この文面は保存されません。コピーするかテキストファイルで保存してください。「【要確認】」の箇所と法令上の記載事項は、発送の前に必ず確かめてください。
          </p>
        </>
      ) : (
        <p className="text-[13px] text-text-muted m-0">
          登録済みの日時・場所・議案から、{documentName}の文面の下書きを作れます。文面はこの画面には保存されません。
        </p>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger m-0">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {editable && (
          <button type="button" className="gt-btn" onClick={() => setDraftContext(context())}>
            <Sparkles size={15} />
            {body ? '文面を編集・作り直す' : `${documentName}の下書きを作る`}
          </button>
        )}
        <button type="button" className="gt-btn" onClick={() => setIsComposing(true)}>
          <FileText size={15} />
          テンプレートから作る
        </button>
        {body && (
          <>
            <button type="button" className="gt-btn" onClick={() => void copy()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'コピーしました' : 'クリップボードにコピー'}
            </button>
            <button type="button" className="gt-btn" onClick={download}>
              <Download size={15} />
              テキストファイルで保存
            </button>
          </>
        )}
        {editable && !written && (
          <>
            {meeting.noticeSentOn !== today && (
              <button type="button" className="gt-btn" onClick={() => void setSentOn(today)} disabled={isSaving}>
                発送日を今日にする
              </button>
            )}
            {meeting.noticeSentOn && (
              <button type="button" className="gt-btn" onClick={() => void setSentOn(null)} disabled={isSaving}>
                発送日の記録を消す
              </button>
            )}
          </>
        )}
      </div>

      <DraftDialog
        isOpen={draftContext != null}
        title={`${documentName}の下書き`}
        kind={draftKindFor(meeting, 'notice')}
        context={draftContext ?? ''}
        initialBody={body}
        useLabel="この文面を使う"
        onUse={(value) => setBody(value)}
        onClose={() => setDraftContext(null)}
      />
      {/* 文書テンプレート（差し込み項目を、この会議の内容に置き換える。AI は使わない） */}
      <ComposeDialog
        isOpen={isComposing}
        title={`${documentName}をテンプレートから作る`}
        subject={{ id: meeting.id, label: meeting.title }}
        kinds={meetingKindsFor(kind === 'board', 'notice', written)}
        useLabel="この文面を使う"
        onUse={(value) => setBody(value)}
        onClose={() => setIsComposing(false)}
      />
    </div>
  );
};
