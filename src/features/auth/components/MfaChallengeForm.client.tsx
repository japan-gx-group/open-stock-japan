'use client';

// ログイン時の二要素認証（/mfa）。パスワードは通ったが、認証アプリのコードの確認がまだの人に出す。
// コードの確認はサーバ（verifyMfaChallenge）で行う（失敗の記録と、連続失敗時の一時停止のため）。
// この画面を通らずにほかの画面や API を開いても、サーバ（getCurrentProfile）と DB（RLS）が通さない。

import type { FormEvent } from 'react';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AuthFormFrame } from '@/features/auth/components/AuthFormFrame';
import { AuthField, bareInputClass } from '@/features/auth/components/AuthField';
import { verifyMfaChallenge } from '@/features/auth/services/mfaChallenge';

interface MfaChallengeFormProps {
  /** 確認が済んだあとに進む先（サーバが安全な相対パスに直したもの） */
  nextPath: string;
  /** ログイン中のメールアドレス（どのアカウントのコードを求めているかを示す） */
  email: string | null;
}

export const MfaChallengeForm = ({ nextPath, email }: MfaChallengeFormProps) => {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const result = await verifyMfaChallenge({ code });
      if (!result.ok) {
        setErrorMessage(result.error);
        setCode('');
        setIsSubmitting(false);
        inputRef.current?.focus();
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setErrorMessage('通信に失敗しました。時間をおいて再度お試しください。');
      setIsSubmitting(false);
    }
  };

  // この端末のセッションだけを終える（ほかの端末のログインは切らない）
  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  };

  return (
    <AuthFormFrame>
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">Two-factor authentication</div>
        <h1 className="mt-2 font-serif text-[30px] font-semibold tracking-[0.2px]">二要素認証</h1>
        <p className="mb-8 mt-2.5 text-sm leading-relaxed text-text-subtle">
          認証アプリに表示されている6桁のコードを入力してください。
          {email && (
            <>
              <br />
              <span className="text-text-heading">{email}</span> としてログイン中です。
            </>
          )}
        </p>

        <AuthField label="認証コード" htmlFor="mfa-code" icon={<ShieldCheck size={17} strokeWidth={1.8} />}>
          <input
            id="mfa-code"
            ref={inputRef}
            className={`${bareInputClass} font-mono tracking-[0.3em]`}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            placeholder="000000"
            autoFocus
            required
          />
        </AuthField>

        {errorMessage && (
          <p className="mt-5 text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !code.trim()}
          className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary px-4 py-[15px] text-[15px] font-semibold text-primary-contrast transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {isSubmitting ? '確認中' : '確認する'}
          {!isSubmitting && <ArrowRight size={17} strokeWidth={2.2} />}
        </button>

        <p className="mt-6 text-xs leading-relaxed text-text-muted">
          機器が手元に無いときは、予備として登録した機器のコードを入力してください。
          登録した機器がすべて使えないときは、管理者に二要素認証のリセットを依頼してください。
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="mt-4 w-fit text-[13px] font-medium text-primary transition-colors hover:text-success disabled:opacity-60"
        >
          ログアウトして、別のアカウントでログインする
        </button>
      </form>
    </AuthFormFrame>
  );
};
