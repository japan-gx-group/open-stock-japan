'use client';

// 株主ポータルの利用状況と操作を、表のセルに収まる大きさで出す部品。
//
// 使い方（株主名簿などの表の 1 セルに置く）:
//   <PortalAccessControl stakeholderId={row.id} stakeholderName={row.name} email={row.email} />
//
// props:
//   stakeholderId   … 権利者（stakeholders.id）
//   stakeholderName … 確認ダイアログとメッセージに出す氏名・名称
//   email           … 権利者のメールアドレス（招待の宛先）。null・空なら「招待」を押せない（理由を title に出す）
//
// 表示:
//   状況のピル（未招待 / 招待済み / 期限切れ / 利用中）と、管理者にだけ操作（招待・再招待 / 招待リンクのコピー / 取り消し）。
//   管理者以外（メンバー・閲覧のみ）には状況だけを出す。権限の正しさはサーバ（requireAdmin）が確かめる。
//   表の列を広げないよう、状況を 1 行目、操作をその下に縦に積む（氏名＋フリガナの 2 行の行と同じ高さに収まる）。
//   ピルと操作のラベルは、どれも「取り消し」の幅（約 64px）に収まる長さにしている（全文は title）。
//   操作が複数ある「招待済み」「期限切れ」は、列に余裕があれば横に並び、無ければ 1 つずつ縦に並ぶ。
//
// 状況は usePortalAccess() が画面全体で 1 回だけ読むので、行ごとにこの部品を置いてもリクエストは増えない。
// CurrentUserProvider（社内の画面のレイアウト）の中で使うこと。

import React, { useState } from 'react';
import { Check, Copy, Loader2, Mail, UserX } from 'lucide-react';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { Modal } from '@/components/ui/Modal.client';
import { isLocalOnlyInviteUrl } from '@/features/settings/services/inviteLink';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { formatDateJa } from '@/lib/equity/format';
import { apiFetch, errorMessage } from '@/lib/resources/client';
import { isAdmin } from '@/types/role';
import { usePortalAccess } from '../hooks/usePortalAccess';
import type { PortalAccessEntry } from '../services/status';

export interface PortalAccessControlProps {
  stakeholderId: string;
  stakeholderName: string;
  email: string | null | undefined;
}

interface InviteResponse {
  inviteUrl: string | null;
  email: string;
  expiresAt: string;
  emailStatus: 'sent' | 'skipped' | 'failed';
}

const pillOf = (entry: PortalAccessEntry | null): { label: string; tone: string } => {
  if (!entry || entry.status === 'none') return { label: '未招待', tone: 'gt-pill-neutral' };
  if (entry.status === 'active') return { label: '利用中', tone: 'gt-pill-good' };
  return entry.isExpired ? { label: '期限切れ', tone: 'gt-pill-warn' } : { label: '招待済み', tone: 'gt-pill-info' };
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

const actionClass =
  'inline-flex items-center gap-1 text-[12px] text-primary hover:underline disabled:text-text-subtle disabled:no-underline disabled:cursor-not-allowed bg-transparent border-0 p-0 cursor-pointer';

export const PortalAccessControl = ({ stakeholderId, stakeholderName, email }: PortalAccessControlProps) => {
  const { role } = useCurrentUser();
  const { statusOf, isLoading, error, reload } = usePortalAccess();
  const [isInviting, setIsInviting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [invited, setInvited] = useState<InviteResponse | null>(null);
  const [isConfirmingRevoke, setIsConfirmingRevoke] = useState(false);
  const [copied, setCopied] = useState(false);

  const entry = statusOf(stakeholderId);
  const canManage = isAdmin(role);
  const hasEmail = Boolean(email?.trim());

  if (isLoading && !entry) {
    return <span className="text-[12px] text-text-subtle">確認中…</span>;
  }
  if (error && !entry) {
    return (
      <span className="text-[12px] text-danger" title={error}>
        取得できません
      </span>
    );
  }

  const pill = pillOf(entry);
  const status = entry?.status ?? 'none';

  const invite = async () => {
    if (isInviting) return;
    setIsInviting(true);
    setActionError(null);
    try {
      const result = await apiFetch<InviteResponse>('/api/portal-access/invite', {
        method: 'POST',
        body: JSON.stringify({ stakeholderId }),
      });
      setInvited(result);
      await reload();
    } catch (caught) {
      setActionError(errorMessage(caught, '招待に失敗しました'));
    } finally {
      setIsInviting(false);
    }
  };

  const copy = async (url: string) => {
    const ok = await copyText(url);
    if (!ok) {
      setActionError('コピーできませんでした。もう一度「再招待」してリンクを表示してください');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const revoke = async () => {
    await apiFetch(`/api/portal-access/${stakeholderId}`, { method: 'DELETE' });
    setIsConfirmingRevoke(false);
    await reload();
  };

  const expiryText = entry?.expiresAt ? `招待リンクの期限: ${formatDateJa(entry.expiresAt.slice(0, 10))}` : null;
  const pillTitle =
    status === 'invited'
      ? entry?.isExpired
        ? `招待の期限切れ${expiryText ? `（${expiryText}）` : ''}`
        : (expiryText ?? undefined)
      : status === 'active'
        ? '株主ポータルのアカウントを作成済み'
        : undefined;

  return (
    <div className="inline-flex flex-col items-start gap-1 align-middle">
      <span className={`gt-pill gt-pill-sm ${pill.tone}`} title={pillTitle}>
        {pill.label}
      </span>
      {canManage && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 whitespace-nowrap">
          {status !== 'active' && (
            <button
              type="button"
              className={actionClass}
              onClick={invite}
              disabled={isInviting || !hasEmail}
              title={hasEmail ? `${email} あてに株主ポータルの招待を発行します` : 'メールアドレスが未登録のため招待できません'}
            >
              {isInviting ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
              {status === 'invited' ? '再招待' : '招待'}
            </button>
          )}
          {status === 'invited' && entry?.inviteUrl && (
            <button
              type="button"
              className={actionClass}
              onClick={() => copy(entry.inviteUrl as string)}
              title="招待リンクをコピー"
              aria-label="招待リンクをコピー"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'コピー済' : 'コピー'}
            </button>
          )}
          {status !== 'none' && (
            <button type="button" className={`${actionClass} !text-danger`} onClick={() => setIsConfirmingRevoke(true)}>
              <UserX size={12} />
              取り消し
            </button>
          )}
        </div>
      )}
      {actionError && (
        <span role="alert" className="max-w-[172px] whitespace-normal text-[12px] text-danger">
          {actionError}
        </span>
      )}

      <Modal isOpen={invited != null} onClose={() => setInvited(null)} title="株主ポータルへの招待" size="lg">
        {invited && (
          <div className="text-[13.5px] leading-relaxed text-text-main">
            <p className="mt-0">
              {stakeholderName} さん（{invited.email}）あての招待を発行しました。
              {invited.emailStatus === 'sent'
                ? '招待メールを送信しました。届かない場合は、下のリンクを本人に伝えてください。'
                : invited.emailStatus === 'failed'
                  ? '招待メールの送信に失敗しました。下のリンクをコピーして、本人に伝えてください。'
                  : 'メール送信が設定されていないため、下のリンクをコピーして、本人に伝えてください。'}
            </p>
            {invited.inviteUrl ? (
              <>
                <div className="flex gap-2">
                  <input className="gt-field flex-1" readOnly value={invited.inviteUrl} aria-label="招待リンク" onFocus={(event) => event.target.select()} />
                  <button type="button" className="gt-btn" onClick={() => copy(invited.inviteUrl as string)}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'コピーしました' : 'コピー'}
                  </button>
                </div>
                {isLocalOnlyInviteUrl(invited.inviteUrl) && (
                  <p className="text-[12px] text-warning mt-2 mb-0">
                    このリンクは localhost を指しているため、ほかの PC では開けません。公開している URL（APP_URL）を設定してから招待し直してください。
                  </p>
                )}
              </>
            ) : (
              <p className="text-[12.5px] text-warning">招待リンクの URL を組み立てられませんでした（APP_URL が未設定）。設定してから「再招待」してください。</p>
            )}
            <p className="text-[12px] text-text-muted mt-3 mb-0">
              リンクの期限: {formatDateJa(invited.expiresAt.slice(0, 10))}。リンクを知っている人は誰でもこの株主としてアカウントを作れます。本人以外に渡さないでください。
              登録すると、この株主の保有状況と、株主に公開した情報だけを見られるようになります。
            </p>
            <div className="flex justify-end mt-5">
              <button type="button" className="gt-btn-primary" onClick={() => setInvited(null)}>
                閉じる
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={isConfirmingRevoke}
        title={status === 'active' ? '株主ポータルのアカウントを削除' : '招待を取り消す'}
        confirmLabel={status === 'active' ? 'アカウントを削除する' : '招待を取り消す'}
        message={
          status === 'active' ? (
            <>
              {stakeholderName} さんの株主ポータルのアカウントを削除します。削除すると、この人はログインできなくなります。
              株主名簿の記録（株式・新株予約権など）は消えません。もう一度使えるようにするには、招待し直します。
            </>
          ) : (
            <>{stakeholderName} さんあての招待を取り消します。送付済みの招待リンクは使えなくなります。</>
          )
        }
        onCancel={() => setIsConfirmingRevoke(false)}
        onConfirm={revoke}
      />
    </div>
  );
};
