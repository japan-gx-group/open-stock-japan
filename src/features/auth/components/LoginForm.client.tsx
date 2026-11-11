'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, Eye, EyeOff, ArrowRight, Info } from 'lucide-react';
import { setSessionPersistence } from '@/lib/supabase/client';
import { getSafeRedirectPath } from '@/features/auth/utils/redirect';
import { signInWithPassword } from '@/features/auth/services/loginClient';
import { mfaRedirectUrl } from '@/features/auth/utils/mfaState';
import { AuthFormFrame } from '@/features/auth/components/AuthFormFrame';
import { AuthField, bareInputClass } from '@/features/auth/components/AuthField';

interface LoginFormProps {
  // 「初期セットアップ」リンクを表示するか。/login のサーバ側でセットアップ状態を
  // 判定して渡される（未セットアップ環境でのみ true）。
  showSetupLink: boolean;
}

export const LoginForm = ({ showSetupLink }: LoginFormProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // ログイン状態を保持するか。チェックを外すと認証 Cookie をセッション Cookie にして
  // ブラウザを閉じたらログアウトさせる（実際の切替は setSessionPersistence 経由で createClient に反映）。
  const [rememberMe, setRememberMe] = useState(true);
  // パスワード再設定フローからの戻り（完了 / リンク切れ）を初回表示に反映する。
  const [errorMessage, setErrorMessage] = useState(() => {
    if (searchParams.get('error') === 'auth_callback') {
      return 'パスワード再設定リンクが無効か期限切れです。再度お試しください。';
    }
    // /signup が「セットアップ状態を判定できない」で /login?setup=error へ送ってきたときの案内。
    // 多くは Supabase への接続設定の誤り。原因の詳細はサーバのログに出ている。
    if (searchParams.get('setup') === 'error') {
      return 'セットアップ状態を確認できませんでした。Supabase への接続設定とサーバのログを確認してください。';
    }
    return '';
  });
  const [infoMessage, setInfoMessage] = useState(() => {
    if (searchParams.get('reset') === 'success') {
      return 'パスワードを更新しました。新しいパスワードでログインしてください。';
    }
    // /signup が「セットアップ済み」で /login?setup=done へ送ってきたときの案内。
    if (searchParams.get('setup') === 'done') {
      return 'この環境は既にセットアップ済みです。ログインしてご利用ください。';
    }
    return '';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setInfoMessage('');

    // 送信の前に希望を記録する。サーバ（POST /api/auth/login）と、以降のブラウザ側の createClient() が
    // この選択（openstock-session-only の Cookie）を読み取り、認証 Cookie の永続/セッションが決まる。
    setSessionPersistence(rememberMe);
    // ログインはサーバ経由で行う（失敗の記録と、連続失敗時の一時停止のため）。
    // セッションの Cookie はサーバの応答が付けるので、ブラウザ側のクライアントもそのまま同じセッションを読める。
    const result = await signInWithPassword(email, password);

    if (!result.ok) {
      setErrorMessage(result.error);
      setIsSubmitting(false);
      return;
    }

    // 二要素認証が要る人は、先にその画面へ送る（元の行き先は next で引き継ぐ）。
    // ここで送らなくても、レイアウトが同じ画面へ送る（強制はサーバが行う）。
    const nextPath = getSafeRedirectPath(searchParams.get('next'));
    router.replace(result.mfa === 'ok' ? nextPath : mfaRedirectUrl(result.mfa, searchParams.get('next') ? nextPath : null));
    router.refresh();
  };

  return (
    <AuthFormFrame>
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">Welcome back</div>
        <h1 className="mb-8 mt-2 font-serif text-[30px] font-semibold tracking-[0.2px]">ログイン</h1>

        <div className="flex flex-col gap-5">
          <AuthField
            label="メールアドレス"
            htmlFor="login-email"
            icon={<Mail size={17} strokeWidth={1.8} />}
          >
            <input
              id="login-email"
              className={bareInputClass}
              type="email"
              value={email}
              autoComplete="email"
              placeholder="you@example.co.jp"
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </AuthField>

          <AuthField
            label="パスワード"
            htmlFor="login-password"
            icon={<Lock size={17} strokeWidth={1.8} />}
            labelAction={
              /* 再設定メールの送信は専用ページ（メール入力→送信→完了表示）で行う */
              <Link
                href="/forgot-password"
                className="text-[13px] font-medium text-primary transition-colors hover:text-success"
              >
                パスワードをお忘れですか？
              </Link>
            }
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
              id="login-password"
              className={bareInputClass}
              type={showPassword ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              placeholder="••••••••"
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </AuthField>
        </div>

        <label className="mt-5 flex w-fit cursor-pointer select-none items-center gap-2.5">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className="h-[18px] w-[18px] rounded-[5px] border-border accent-primary"
          />
          <span className="text-[13px] text-text-subtle">ログイン状態を保持する</span>
        </label>

        {errorMessage && (
          <p className="mt-5 text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        )}

        {infoMessage && (
          <p className="mt-5 text-sm text-primary" role="status">
            {infoMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary px-4 py-[15px] text-[15px] font-semibold text-primary-contrast transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {isSubmitting ? 'ログイン中' : 'ログイン'}
          {!isSubmitting && <ArrowRight size={17} strokeWidth={2.2} />}
        </button>

        {/* デモ用アカウントの案内は開発時のみ。加えて、未セットアップ環境（組織 0 件）では
            デモシード（supabase/seeds/demo/demo.sql）が入っておらずこのアカウントで
            ログインできないため、セットアップ済みのときだけ表示する。 */}
        {process.env.NODE_ENV === 'development' && !showSetupLink && (
          <div className="mt-6 flex items-start gap-2.5 rounded-[10px] bg-bg-subtle px-[15px] py-[13px]">
            <Info size={16} strokeWidth={1.8} className="mt-px shrink-0 text-text-subtle" />
            <p className="text-xs leading-relaxed text-text-subtle">
              ローカル確認用：<span className="text-text-heading">admin@example.com</span> /{' '}
              <span className="text-text-heading">shareholder@example.com</span>、パスワード{' '}
              <span className="text-text-heading">password123</span>
            </p>
          </div>
        )}

        {/* 初回セットアップ（初期登録）への導線。未セットアップ環境でのみ表示する
            （組織が既にある環境では /signup 側のガードで /login に戻されるだけのため）。
            遷移先（next）を引き継ぎ、セットアップ完了後も元の目的ページへ戻れるようにする。 */}
        {showSetupLink && (
          <p className="mt-6 text-xs text-text-muted">
            この環境をまだセットアップしていない場合は{' '}
            <Link
              href={nextParam ? `/signup?next=${encodeURIComponent(nextParam)}` : '/signup'}
              className="font-medium text-primary hover:text-success"
            >
              初期セットアップ
            </Link>
          </p>
        )}
      </form>
    </AuthFormFrame>
  );
};
