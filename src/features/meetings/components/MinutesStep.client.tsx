'use client';

// 手順 5: 議事録。AI の下書き・手入力 → 保存（meetings.minutesBody）→ 確定 → 印刷。

import React, { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Lock, Printer, Sparkles, Unlock } from 'lucide-react';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { DraftDialog } from '@/components/resource/DraftDialog.client';
import { ComposeDialog } from '@/features/templates/components/ComposeDialog.client';
import { meetingKindsFor } from '@/features/templates/services/kinds';
import { formatDateJa, formatDateWareki, todayInTokyo } from '@/lib/equity/format';
import { LEGAL } from '@/lib/legal/rules';
import { recordActivity } from '@/lib/audit/activityClient';
import { draftKindFor, isWrittenResolution } from '../services/meetingRules';
import type { MeetingKind, MeetingRow } from '../types';

// 印刷のときは議事録だけを出す。印刷用の本文を body の直下に置き、それ以外を隠す。
// このコンポーネントが画面にある間だけ効く（style 要素ごと外れる）。
const PRINT_CSS = `
.meeting-minutes-print-root { display: none; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.meeting-minutes-print-root) { display: none !important; }
  .meeting-minutes-print-root {
    display: block !important;
    color: #000;
    font-size: 11pt;
    line-height: 1.9;
  }
  .meeting-minutes-print-root .meeting-minutes-print-title { font-size: 9pt; margin-bottom: 16pt; }
  .meeting-minutes-print-root .meeting-minutes-print-body { white-space: pre-wrap; overflow-wrap: anywhere; }
}
`;

const subscribeNothing = () => () => {};

export const MinutesStep = ({
  meeting,
  kind,
  companyName,
  context,
  editable,
  onUpdateMeeting,
}: {
  meeting: MeetingRow;
  kind: MeetingKind;
  companyName: string;
  context: () => string;
  editable: boolean;
  onUpdateMeeting: (overrides: Record<string, unknown>) => Promise<void>;
}) => {
  const [draftContext, setDraftContext] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [confirm, setConfirm] = useState<'finalize' | 'reopen' | null>(null);
  const board = kind === 'board';
  const written = isWrittenResolution(meeting);
  const hasBody = meeting.minutesBody.trim() !== '';
  const finalized = meeting.minutesFinalizedOn != null;
  // document.body へのポータルはブラウザでだけ描く
  const isClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [printError, setPrintError] = useState<string | null>(null);

  // 印刷（紙や PDF への持ち出し）の前に監査ログに残す。残せなかったら印刷の画面を出さない
  const printMinutes = async () => {
    setPrintError(null);
    try {
      await recordActivity('print.meeting_minutes', { entityId: String(meeting.id) });
    } catch (caught) {
      setPrintError(caught instanceof Error ? caught.message : '印刷の記録を残せなかったため、中止しました');
      return;
    }
    window.print();
  };

  return (
    <div className="flex flex-col gap-3">
      <style>{PRINT_CSS}</style>
      {isClient &&
        hasBody &&
        createPortal(
          <div className="meeting-minutes-print-root">
            <div className="meeting-minutes-print-title">
              {companyName} {meeting.title}（{formatDateWareki(meeting.heldOn)}）
            </div>
            <div className="meeting-minutes-print-body">{meeting.minutesBody}</div>
          </div>,
          document.body,
        )}

      <ul className="m-0 pl-5 list-disc text-[13px] leading-relaxed text-text-body">
        <li>
          議事録は、{board ? '取締役会' : '株主総会'}の日{written ? '（書面決議は決議があったとみなされた日）' : ''}から <span className="whitespace-nowrap">{LEGAL.minutesRetentionYears} 年間</span>、本店に備え置きます（
          {board ? '会社法371条1項' : '会社法318条2項'}）。書面決議の場合も議事録の作成が必要です。
        </li>
        <li>
          {board
            ? written
              ? '書面決議の議事録は出席者がいないため、会社法369条3項の署名・記名押印の義務は条文上生じません（実務上は議事録を作成した取締役が記名押印または電子署名をします）。'
              : '出席した取締役および監査役は、議事録に署名または記名押印をします（会社法369条3項）。電磁的記録で作成する場合は電子署名が必要です（会社法369条4項）。'
            : '会社法上、株主総会議事録への署名・記名押印の義務はありません（取締役会議事録と異なります）。定款で定めている場合はそれに従います。登記の添付書面にする場合の押印は司法書士に確認してください。'}
        </li>
      </ul>

      {hasBody ? (
        <div className="max-h-[520px] overflow-auto rounded-md border border-border bg-bg-subtle px-5 py-4 text-[13.5px] leading-[1.9] text-text-main">
          <div className="whitespace-pre-wrap break-words">{meeting.minutesBody}</div>
        </div>
      ) : (
        <p className="text-[13px] text-text-muted m-0">
          議事録はまだありません。{editable ? '登録済みの議案・出欠・採決の結果から下書きを作るか、直接入力できます。' : ''}
        </p>
      )}

      {finalized && (
        <p className="text-[13px] text-success m-0 font-semibold">{formatDateJa(meeting.minutesFinalizedOn)} に確定しました。</p>
      )}

      {printError && (
        <p role="alert" className="text-[12.5px] text-danger m-0">
          {printError}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {editable && !finalized && (
          <button type="button" className="gt-btn" onClick={() => setDraftContext(context())}>
            <Sparkles size={15} />
            {hasBody ? '議事録を編集・作り直す' : '議事録を作成'}
          </button>
        )}
        {editable && !finalized && (
          <button type="button" className="gt-btn" onClick={() => setIsComposing(true)}>
            <FileText size={15} />
            テンプレートから作る
          </button>
        )}
        {hasBody && (
          <button type="button" className="gt-btn" onClick={printMinutes}>
            <Printer size={15} />
            印刷用に表示
          </button>
        )}
        {editable && hasBody && !finalized && (
          <button type="button" className="gt-btn-primary" onClick={() => setConfirm('finalize')}>
            <Lock size={15} />
            議事録を確定
          </button>
        )}
        {editable && finalized && (
          <button type="button" className="gt-btn" onClick={() => setConfirm('reopen')}>
            <Unlock size={15} />
            確定を取り消す
          </button>
        )}
      </div>

      <DraftDialog
        isOpen={draftContext != null}
        title="議事録"
        kind={draftKindFor(meeting, 'minutes')}
        context={draftContext ?? ''}
        initialBody={meeting.minutesBody}
        useLabel="議事録として保存"
        onUse={(body) => onUpdateMeeting({ minutesBody: body })}
        onClose={() => setDraftContext(null)}
      />
      {/* 文書テンプレート（差し込み項目を、この会議の内容に置き換える。AI は使わない） */}
      <ComposeDialog
        isOpen={isComposing}
        title="議事録をテンプレートから作る"
        subject={{ id: meeting.id, label: meeting.title }}
        kinds={meetingKindsFor(board, 'minutes', written)}
        useLabel={hasBody ? '議事録を置き換えて保存' : '議事録として保存'}
        onUse={(body) => onUpdateMeeting({ minutesBody: body })}
        onClose={() => setIsComposing(false)}
      />

      <ConfirmDialog
        isOpen={confirm === 'finalize'}
        title="議事録を確定"
        destructive={false}
        confirmLabel="確定する"
        message={
          <>
            議事録を確定し、進行状況を「議事録確定」にします（確定日: {formatDateJa(todayInTokyo())}）。確定後は、取り消すまで本文を編集できません。
            {board && !written && ' 確定した議事録は印刷し、出席した取締役・監査役の署名または記名押印を受けてください。'}
          </>
        }
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await onUpdateMeeting({ minutesFinalizedOn: todayInTokyo(), status: 'closed' });
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        isOpen={confirm === 'reopen'}
        title="確定を取り消す"
        destructive={false}
        confirmLabel="取り消す"
        message="議事録の確定を取り消し、進行状況を「開催済み」に戻します。本文を編集できるようになります。"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await onUpdateMeeting({ minutesFinalizedOn: null, status: 'held' });
          setConfirm(null);
        }}
      />
    </div>
  );
};
