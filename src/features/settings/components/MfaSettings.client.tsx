'use client';

// 自分のアカウントの二要素認証（認証アプリ・TOTP）の状態と、登録・解除。
// アカウント設定の画面（社内のロール）と、/mfa/setup（株主ロールを含む全ロール）に置く。
// 登録・解除はサーバ（src/features/settings/services/mfa.ts）が行い、ここは表示と入力だけ。
// 強制（登録した人はコードを確認するまで使えない）は、サーバと DB が行う。

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Smartphone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/Modal.client';
import { formatDateTime } from '@/lib/datetime';
import { getMfaOverview, removeMfaFactor } from '@/features/settings/services/mfa';
import type { MfaFactorSummary, MfaOverview } from '@/features/settings/services/mfaTypes';
import { MfaEnrollPanel } from './MfaEnrollPanel.client';

export const MfaSettings = ({
  showToast,
}: {
  showToast: (message: string, type: 'success' | 'error') => void;
}) => {
  const router = useRouter();
  const [overview, setOverview] = useState<MfaOverview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [isEnrollOpen, setIsEnrollOpen] = useState(false);
  const [factorToRemove, setFactorToRemove] = useState<MfaFactorSummary | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [isRemoving, setIsRemoving] = useState(false);

  // 取得と反映を分ける（effect 本体での同期 setState を避ける。FiscalYearList と同じ形）
  const applyOverview = useCallback((result: Awaited<ReturnType<typeof getMfaOverview>>) => {
    if (result.ok) {
      setLoadError('');
      setOverview(result.data);
    } else {
      setLoadError(result.error);
    }
  }, []);

  const reload = useCallback(
    () =>
      getMfaOverview()
        .then(applyOverview)
        .catch(() => setLoadError('二要素認証の状態を取得できませんでした')),
    [applyOverview],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const factors = overview?.factors ?? [];
  const canAdd = overview !== null && factors.length < overview.maxFactors;

  const handleEnrolled = async () => {
    setIsEnrollOpen(false);
    showToast('二要素認証を登録しました。次回のログインから、コードの入力が必要になります。', 'success');
    await reload();
    // セッションが変わった（コードを確認済みになった）ので、サーバ側の表示も取り直す
    router.refresh();
  };

  const closeRemove = () => {
    setFactorToRemove(null);
    setCurrentPassword('');
    setRemoveError('');
  };

  const handleRemove = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!factorToRemove || isRemoving) return;
    setIsRemoving(true);
    setRemoveError('');
    try {
      const result = await removeMfaFactor({ factorId: factorToRemove.id, currentPassword });
      if (!result.ok) {
        setRemoveError(result.error);
        return;
      }
      closeRemove();
      showToast('機器を解除しました', 'success');
      await reload();
      // ほかの機器が残っていれば、その機器のコードの確認へ送られる（レイアウトが振り分ける）
      router.refresh();
    } catch {
      setRemoveError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4" data-testid="mfa-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif font-semibold text-lg text-text-heading flex items-center gap-2">
          <KeyRound size={18} className="text-primary" />
          二要素認証
          {overview &&
            (factors.length > 0 ? (
              <span className="gt-pill gt-pill-sm gt-pill-good">設定済み（{factors.length}台）</span>
            ) : (
              <span className="gt-pill gt-pill-sm gt-pill-neutral">未設定</span>
            ))}
          {overview?.required && <span className="gt-pill gt-pill-sm gt-pill-info">組織の設定で必須</span>}
        </h2>
        {canAdd && (
          <button type="button" className="gt-btn-primary text-xs" onClick={() => setIsEnrollOpen(true)}>
            {factors.length === 0 ? '設定する' : '予備の機器を追加'}
          </button>
        )}
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        ログインのときに、パスワードに加えて、スマートフォンの認証アプリに表示される6桁のコードを確認します。
        パスワードが漏れても、認証アプリの入った機器が無ければログインできません。
      </p>
      <hr className="border-border" />

      {loadError ? (
        <p className="text-sm text-danger" role="alert">
          {loadError}
        </p>
      ) : overview === null ? (
        <p className="text-sm text-text-muted py-2 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          読み込み中...
        </p>
      ) : factors.length === 0 ? (
        <p className="text-sm text-text-main">
          まだ設定していません。
          {overview.required
            ? '組織の設定で必須になっています。「設定する」から登録してください。'
            : '「設定する」から、認証アプリを登録できます。'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {factors.map((factor) => (
            <li key={factor.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light py-2.5 last:border-b-0">
              <div className="flex items-center gap-3 min-w-0">
                <Smartphone size={18} className="shrink-0 text-text-muted" />
                <div className="min-w-0">
                  <div className="font-medium text-text-main truncate">{factor.name}</div>
                  {factor.createdAt && (
                    <div className="text-xs text-text-muted">登録: {formatDateTime(factor.createdAt)}</div>
                  )}
                </div>
              </div>
              <button type="button" className="gt-btn text-xs" onClick={() => setFactorToRemove(factor)}>
                解除する
              </button>
            </li>
          ))}
        </ul>
      )}

      {overview !== null && (
        <p className="text-xs leading-relaxed text-text-muted border-t border-border pt-4">
          リカバリーコード（予備のコード）はありません。機器の故障・紛失に備えて、予備の機器をもう1台登録しておくことをおすすめします
          （登録できるのは{overview.maxFactors}台まで）。登録した機器がすべて使えなくなったときは、管理者に二要素認証のリセットを依頼してください。
        </p>
      )}

      <Modal isOpen={isEnrollOpen} onClose={() => setIsEnrollOpen(false)} title="二要素認証の登録" size="lg">
        {isEnrollOpen && (
          <MfaEnrollPanel
            defaultName={factors.length === 0 ? '認証アプリ' : '予備の機器'}
            onCompleted={handleEnrolled}
            onCancel={() => setIsEnrollOpen(false)}
          />
        )}
      </Modal>

      <Modal isOpen={factorToRemove !== null} onClose={closeRemove} title="機器の解除">
        <form onSubmit={handleRemove} className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-text-main">
            「{factorToRemove?.name}」を解除します。
            {factors.length <= 1
              ? '解除すると、パスワードだけでログインできる状態に戻ります。'
              : '解除したあと、残した機器のコードの入力を求められます。'}
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="mfa-remove-password" className="text-xs font-bold text-text-muted">
              本人確認のため、現在のパスワードを入力してください
            </label>
            <input
              id="mfa-remove-password"
              type="password"
              className="gt-field"
              value={currentPassword}
              autoComplete="current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>
          {removeError && (
            <p className="text-sm text-danger" role="alert">
              {removeError}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" className="gt-btn text-sm" onClick={closeRemove} disabled={isRemoving}>
              キャンセル
            </button>
            <button
              type="submit"
              className="gt-btn-primary text-sm bg-danger hover:bg-danger/90 flex items-center gap-2"
              disabled={isRemoving || !currentPassword}
            >
              {isRemoving && <Loader2 size={16} className="animate-spin" />}
              解除する
            </button>
          </div>
        </form>
      </Modal>
    </Card>
  );
};
