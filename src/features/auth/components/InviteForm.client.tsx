'use client';

// 招待リンク（/invite/[token]）の登録フォーム。
// 組織名・メールはサーバで検証済みの読み取り専用情報として表示し、
// ユーザーは氏名とパスワードだけを設定する。成功したらそのままログインして /dashboard へ。

import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, User, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { acceptInvite } from '@/features/auth/services/invites';
import { signInWithPassword } from '@/features/auth/services/loginClient';
import { getSafeRedirectPath } from '@/features/auth/utils/redirect';
import { mfaRedirectUrl } from '@/features/auth/utils/mfaState';
import { PASSWORD_POLICY_HINT, validateNewPassword } from '@/lib/security/passwordPolicy';
import type { ActionResult, InviteInfo } from '@/features/auth/types';
import { AuthFormFrame } from '@/features/auth/components/AuthFormFrame';
import { AuthField, bareInputClass } from '@/features/auth/components/AuthField';

interface InviteFormProps {
  token: string;
  // サーバ（getInviteForToken）での検証結果。無効な招待ならエラーを表示する。
  result: ActionResult<InviteInfo>;
}

export const InviteForm = ({ token, result }: InviteFormProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 同一tickの多重送信を確実に止める同期ガード（state の disabled だけでは防げない）。
  const submittingRef = useRef(false);

  // 無効・期限切れ・使用済みの招待はフォームを出さずに理由だけ表示する。
  if (!result.ok) {
    return (
      <AuthFormFrame>
        <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">Invitation</div>
        <h1 className="mt-2 font-serif text-[30px] font-semibold tracking-[0.2px]">
          招待を確認できません
        </h1>
        <p className="mt-5 text-sm text-danger" role="alert">
          {result.error}
        </p>
        <p className="mt-6 text-xs leading-relaxed text-text-muted">
          管理者に新しい招待リンクの発行を依頼してください。既にアカウントをお持ちの場合は{' '}
          <Link href="/login" className="font-medium text-primary hover:text-success">
            ログイン
          </Link>
        </p>
      </AuthFormFrame>
    );
  }

  const invite = result.data;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }
    if (!fullName.trim()) {
      setErrorMessage('氏名を入力してください');
      return;
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage('');

    const fail = (msg: string) => {
      setErrorMessage(msg);
      setIsSubmitting(false);
      submittingRef.current = false;
    };

    try {
      const accepted = await acceptInvite({ token, fullName, password });
      if (!accepted.ok) {
        fail(accepted.error);
        return;
      }

      // 登録したアカウントでそのままログインする（ログインはサーバ経由。LoginForm と同じ API）。
      const signedIn = await signInWithPassword(accepted.data.email, password);
      if (!signedIn.ok) {
        router.replace('/login');
        return;
      }

      // 組織が二要素認証を必須にしていれば、先にその登録へ送る（強制はサーバが行う。ここは案内）
      const nextPath = invite.isShareholder ? '/external-portal' : getSafeRedirectPath(searchParams.get('next'));
      router.replace(signedIn.mfa === 'ok' ? nextPath : mfaRedirectUrl(signedIn.mfa, nextPath));
      router.refresh();
    } catch {
      fail('通信に失敗しました。時間をおいて再度お試しください');
    }
  };

  return (
    <AuthFormFrame>
      <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">{invite.isShareholder ? 'Shareholder portal' : 'Join organization'}</div>
      <h1 className="mt-2 font-serif text-[30px] font-semibold leading-[1.25] tracking-[0.2px]">
        {invite.isShareholder ? `${invite.organizationName} 株主ポータル` : `${invite.organizationName} に参加`}
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-text-subtle">
        {invite.isShareholder
          ? '株主ポータルでは、ご自身の保有状況と、会社が株主向けに公開したお知らせ・決算情報・資料を確認できます。氏名とパスワードを設定してください。'
          : '招待を受けたアカウントの氏名とパスワードを設定してください。'}
      </p>
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
        <AuthField
          label="メールアドレス"
          htmlFor="invite-email"
          icon={<Mail size={17} strokeWidth={1.8} />}
        >
          {/* 招待に紐づくメールは変更不可のため読み取り専用で表示する */}
          <input
            id="invite-email"
            className={`${bareInputClass} cursor-not-allowed`}
            type="email"
            value={invite.email}
            readOnly
            disabled
          />
        </AuthField>

        <AuthField
          label="氏名"
          htmlFor="invite-name"
          icon={<User size={17} strokeWidth={1.8} />}
        >
          <input
            id="invite-name"
            className={bareInputClass}
            type="text"
            value={fullName}
            autoComplete="name"
            placeholder="例: 山田 太郎"
            onChange={(event) => setFullName(event.target.value)}
            required
          />
        </AuthField>

        <AuthField
          label="パスワード"
          htmlFor="invite-password"
          icon={<Lock size={17} strokeWidth={1.8} />}
          hint={PASSWORD_POLICY_HINT}
          adornment={
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
              className="flex shrink-0 p-1 text-text-label transition-colors hover:text-text-muted"
            >
              {showPassword ? (
                <EyeOff size={18} strokeWidth={1.8} />
              ) : (
                <Eye size={18} strokeWidth={1.8} />
              )}
            </button>
          }
        >
          <input
            id="invite-password"
            className={bareInputClass}
            type={showPassword ? 'text' : 'password'}
            value={password}
            autoComplete="new-password"
            placeholder="••••••••"
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </AuthField>

        {errorMessage && (
          <p className="text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-1 flex w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary px-4 py-[15px] text-[15px] font-semibold text-primary-contrast transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {isSubmitting ? '登録中' : invite.isShareholder ? '登録して株主ポータルを開く' : '登録して参加'}
          {!isSubmitting && <ArrowRight size={17} strokeWidth={2.2} />}
        </button>
      </form>
    </AuthFormFrame>
  );
};
