'use client';

// 組織・メンバー設定の「セキュリティ」カード。
//   - 社内のアカウントに二要素認証を必須にする設定（変えられるのは管理者だけ。Server Action が requireAdmin で確かめる）
//   - パスワードの決まり・ログインの失敗時の一時停止・セッションの有効期限の案内（表示だけ）
// 設定の保存と強制はサーバ（src/features/settings/services/mfaAdmin.ts・getCurrentProfile）と DB が行う。

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/Modal.client';
import { PASSWORD_POLICY_HINT } from '@/lib/security/passwordPolicy';
import { INTERNAL_ROLES, memberRoleLabel } from '@/types/role';
import { LOGIN_LOCKOUT_RULE, lockoutWindowMinutes } from '@/features/auth/utils/loginLockout';
import { SESSION_INACTIVITY_HOURS, SESSION_TIMEBOX_HOURS } from '@/features/auth/utils/sessionPolicy';
import { getSecurityPolicy, setRequireMfaForInternal } from '@/features/settings/services/mfaAdmin';
import type { SecurityPolicy } from '@/features/settings/services/mfaTypes';

// 対象のロールの表示名（ロールが増えても、src/types/role.ts に合わせて変わる）
const INTERNAL_ROLE_LABELS = INTERNAL_ROLES.map((role) => memberRoleLabel(role)).join('・');

export const SecurityPolicyCard = ({
  showToast,
}: {
  showToast: (message: string, type: 'success' | 'error') => void;
}) => {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [loadError, setLoadError] = useState('');
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const applyPolicy = useCallback((result: Awaited<ReturnType<typeof getSecurityPolicy>>) => {
    if (result.ok) {
      setLoadError('');
      setPolicy(result.data);
    } else {
      setLoadError(result.error);
    }
  }, []);

  useEffect(() => {
    getSecurityPolicy()
      .then(applyPolicy)
      .catch(() => setLoadError('セキュリティの設定を取得できませんでした'));
  }, [applyPolicy]);

  const closeConfirm = () => {
    setPendingValue(null);
    setSaveError('');
  };

  const handleSave = async () => {
    if (pendingValue === null || isSaving) return;
    setIsSaving(true);
    setSaveError('');
    try {
      const result = await setRequireMfaForInternal(pendingValue);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setPolicy((current) => (current ? { ...current, requireMfaForInternal: result.data.requireMfaForInternal } : current));
      showToast(
        result.data.requireMfaForInternal ? '社内のアカウントの二要素認証を必須にしました' : '二要素認証の必須をやめました',
        'success',
      );
      closeConfirm();
    } catch {
      setSaveError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setIsSaving(false);
    }
  };

  const notEnrolled = policy?.internalMfaCount ? policy.internalMfaCount.total - policy.internalMfaCount.enrolled : null;
  const lockMinutes = lockoutWindowMinutes(LOGIN_LOCKOUT_RULE);

  return (
    <Card className="flex flex-col gap-4" data-testid="security-policy">
      <div className="flex items-center gap-2">
        <h2 className="font-serif font-semibold text-lg text-text-heading flex items-center gap-2">
          <ShieldCheck size={18} className="text-primary" />
          セキュリティ
        </h2>
      </div>
      <p className="text-xs text-text-muted">ログインの守り方の設定と、いまの決まりです。</p>
      <hr className="border-border" />

      {/* --- 二要素認証の必須化 --- */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-text-main">二要素認証の必須化</span>
            {policy &&
              (policy.requireMfaForInternal ? (
                <span className="gt-pill gt-pill-sm gt-pill-good">必須</span>
              ) : (
                <span className="gt-pill gt-pill-sm gt-pill-neutral">任意</span>
              ))}
          </div>
          {policy?.canEdit && (
            <button
              type="button"
              className={policy.requireMfaForInternal ? 'gt-btn text-xs' : 'gt-btn-primary text-xs'}
              onClick={() => setPendingValue(!policy.requireMfaForInternal)}
              disabled={!policy.requireMfaForInternal && !policy.viewerHasMfa}
            >
              {policy.requireMfaForInternal ? '必須をやめる' : '必須にする'}
            </button>
          )}
        </div>
        <p className="text-sm leading-relaxed text-text-main">
          社内のアカウント（{INTERNAL_ROLE_LABELS}）に二要素認証を必須にする。
        </p>
        <p className="text-xs leading-relaxed text-text-muted">
          必須にすると、認証アプリを登録していない社内のアカウントは、登録が済むまで画面もデータも使えなくなります。
          株主のアカウントは対象外です（本人が任意で設定できます）。必須にしていなくても、登録した人はログインのたびにコードの入力が必要です。
        </p>
        {loadError && (
          <p className="text-sm text-danger" role="alert">
            {loadError}
          </p>
        )}
        {!policy && !loadError && (
          <p className="text-sm text-text-muted flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            読み込み中...
          </p>
        )}
        {policy?.internalMfaCount && (
          <p className="text-xs text-text-muted">
            登録済み: 社内のアカウント {policy.internalMfaCount.total} 人のうち {policy.internalMfaCount.enrolled} 人
          </p>
        )}
        {policy?.canEdit && !policy.requireMfaForInternal && !policy.viewerHasMfa && (
          <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning">
            <AlertTriangle size={15} className="mt-px shrink-0" />
            <span>
              必須にする前に、ご自身の二要素認証を登録してください（
              <Link href="/settings/account" className="underline">
                アカウント設定
              </Link>
              ）。登録せずに必須にすると、ご自身も登録が済むまで操作できなくなるため、先に登録を求めています。
            </span>
          </p>
        )}
        {policy && !policy.canEdit && <p className="text-xs text-text-muted">この設定を変えられるのは管理者だけです。</p>}
      </div>

      <hr className="border-border" />

      {/* --- 決まりの案内（表示だけ） --- */}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[150px_1fr]">
        <dt className="font-semibold text-text-muted">パスワード</dt>
        <dd className="text-text-main">{PASSWORD_POLICY_HINT}（新しく設定・変更するときに確かめます）</dd>
        <dt className="font-semibold text-text-muted">ログインの失敗</dt>
        <dd className="text-text-main">
          同じメールアドレスで {lockMinutes} 分のあいだに {LOGIN_LOCKOUT_RULE.maxFailures} 回失敗すると、{lockMinutes} 分間ログインできなくなります。
          二要素認証のコードも同じ決まりです。失敗と停止は監査ログに残ります。
        </dd>
        <dt className="font-semibold text-text-muted">セッションの有効期限</dt>
        <dd className="text-text-main">
          ログインから {SESSION_TIMEBOX_HOURS} 時間、または操作の無いまま {SESSION_INACTIVITY_HOURS} 時間がたつと、ログインし直しになります。
        </dd>
      </dl>
      <p className="text-xs leading-relaxed text-text-muted">
        パスワードの決まりとセッションの有効期限は、認証サービスの設定で決まっています（変更は、システムの運用担当者が行います）。
      </p>

      <Modal
        isOpen={pendingValue !== null}
        onClose={closeConfirm}
        title={pendingValue ? '二要素認証を必須にする' : '二要素認証の必須をやめる'}
      >
        <div className="flex flex-col gap-4">
          {pendingValue ? (
            <p className="text-sm leading-relaxed text-text-main">
              社内のアカウント（{INTERNAL_ROLE_LABELS}）に二要素認証を必須にします。
              {notEnrolled !== null && notEnrolled > 0
                ? `まだ登録していない ${notEnrolled} 人は、次に画面を開いたときから、認証アプリの登録が済むまで操作できなくなります。先に周知しておくことをおすすめします。`
                : '登録していないアカウントは、次に画面を開いたときから、認証アプリの登録が済むまで操作できなくなります。'}
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-text-main">
              二要素認証の必須をやめます。登録済みの人は、これまでどおりログインのたびにコードの入力が必要です。
              未登録の人は、パスワードだけでログインできるようになります。
            </p>
          )}
          {saveError && (
            <p className="text-sm text-danger" role="alert">
              {saveError}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" className="gt-btn text-sm" onClick={closeConfirm} disabled={isSaving}>
              キャンセル
            </button>
            <button type="button" className="gt-btn-primary text-sm flex items-center gap-2" onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 size={16} className="animate-spin" />}
              {pendingValue ? '必須にする' : '必須をやめる'}
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
};
