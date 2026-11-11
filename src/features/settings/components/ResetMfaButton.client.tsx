'use client';

// メンバーの二要素認証をリセットするボタン（管理者用。メンバー一覧の行に置く）。
// 認証アプリの入った機器をなくした・替えたメンバーが、パスワードだけでログインし直せるようにする。
// 権限（管理者だけ・自分には使えない・自組織のメンバーだけ）はサーバ（resetMemberMfa）が確かめ、
// 監査ログに auth.mfa.reset として残す。ここは確認と結果の表示だけ。
//
// 使い方:
//   const status = await getMembersMfaStatus();   // { [メンバーの id]: 登録済みか }（管理者だけが読める）
//   <ResetMfaButton memberId={member.id} memberName={member.fullName ?? member.email} hasMfa={status[member.id] === true}
//                   onReset={reloadStatus} showToast={showToast} />
// hasMfa が false のメンバーには何も出さない。

import React, { useState } from 'react';
import { Loader2, ShieldOff } from 'lucide-react';
import { Modal } from '@/components/ui/Modal.client';
import { resetMemberMfa } from '@/features/settings/services/mfaAdmin';

export const ResetMfaButton = ({
  memberId,
  memberName,
  hasMfa,
  onReset,
  showToast,
  className = 'gt-btn text-xs',
}: {
  memberId: string;
  /** 確認の文に出す名前（氏名が無ければメールアドレス） */
  memberName: string;
  /** そのメンバーが二要素認証を登録済みか（getMembersMfaStatus の値） */
  hasMfa: boolean;
  /** リセットが済んだとき（一覧の取り直しなど） */
  onReset?: () => void;
  showToast?: (message: string, type: 'success' | 'error') => void;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');

  if (!hasMfa) return null;

  const close = () => {
    setIsOpen(false);
    setError('');
  };

  const handleReset = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setError('');
    try {
      const result = await resetMemberMfa(memberId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsOpen(false);
      showToast?.(`${memberName} さんの二要素認証をリセットしました`, 'success');
      onReset?.();
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <>
      <button type="button" className={`${className} inline-flex items-center gap-1`} onClick={() => setIsOpen(true)}>
        <ShieldOff size={14} />
        二要素認証をリセット
      </button>
      <Modal isOpen={isOpen} onClose={close} title="二要素認証のリセット">
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-text-main">
            {memberName} さんの二要素認証をリセットします。登録してある機器がすべて解除され、パスワードだけでログインできる状態に戻ります
            （組織が必須にしている場合は、次のログインで登録し直しを求められます）。
          </p>
          <p className="text-xs leading-relaxed text-text-muted">
            本人からの依頼であることを、対面や電話など別の手段で確かめてから行ってください。この操作は監査ログに残ります。
          </p>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" className="gt-btn text-sm" onClick={close} disabled={isRunning}>
              キャンセル
            </button>
            <button
              type="button"
              className="gt-btn-primary text-sm bg-danger hover:bg-danger/90 flex items-center gap-2"
              onClick={handleReset}
              disabled={isRunning}
            >
              {isRunning && <Loader2 size={16} className="animate-spin" />}
              リセットする
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};
