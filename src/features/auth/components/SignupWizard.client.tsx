'use client';

// 初回登録ウィザード（初期セットアップ）。
// ①アカウント（氏名・メール・パスワード）→ ②企業情報 のステップ形式。
// 最後にサーバ（setupOrganization）で組織・admin・最初の事業年度・普通株式をまとめて作り、
// 成功したらそのままクライアントでログインして /dashboard へ進む。

import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Building2,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { setupOrganization } from '@/features/auth/services/setup';
import { signInWithPassword } from '@/features/auth/services/loginClient';
import { getSafeRedirectPath } from '@/features/auth/utils/redirect';
import { mfaRedirectUrl } from '@/features/auth/utils/mfaState';
import { AuthFormFrame } from '@/features/auth/components/AuthFormFrame';
import { AuthField, bareInputClass } from '@/features/auth/components/AuthField';
import { isValidEmail } from '@/lib/email';
import { PASSWORD_POLICY_HINT, validateNewPassword } from '@/lib/security/passwordPolicy';

const STEPS = ['アカウント', '企業情報'] as const;

// フッター操作ボタンの共通スタイル（デザイン正のトーンに合わせた角丸のブランド色 / アウトライン）。
const primaryBtnClass =
  'flex items-center justify-center gap-2 rounded-[11px] bg-primary px-5 py-3 text-sm font-semibold text-primary-contrast transition-colors hover:bg-primary-dark disabled:opacity-60';
const outlineBtnClass =
  'flex items-center justify-center gap-2 rounded-[11px] border border-border bg-bg-card px-5 py-3 text-sm font-semibold text-text-heading transition-colors hover:bg-bg-subtle disabled:opacity-60';

export const SignupWizard = ({ requiresSetupToken = false }: { requiresSetupToken?: boolean }) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // React の state 更新は非同期なので、button の disabled だけでは同一tick内の
  // 二重クリックを防げない。ref を同期的に立てて多重送信を確実に止める。
  const submittingRef = useRef(false);

  // ①アカウント
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // ②企業情報
  const [organizationName, setOrganizationName] = useState('');
  // セットアップ用の合言葉（環境変数 SETUP_TOKEN を設定している環境でだけ入力する）
  const [setupToken, setSetupToken] = useState('');

  // 各ステップの「次へ」を押せるかの検証。
  const validateStep = (): string => {
    if (step === 0) {
      if (!fullName.trim() || !email.trim() || !password) {
        return '氏名・メールアドレス・パスワードを入力してください';
      }
      // 「次へ」は type="button" なので input type="email" のブラウザ検証は効かない。ここで明示的に検証する。
      if (!isValidEmail(email)) {
        return 'メールアドレスの形式が正しくありません';
      }
      const passwordError = validateNewPassword(password);
      if (passwordError) {
        return passwordError;
      }
    }
    if (step === 1) {
      if (!organizationName.trim()) {
        return '企業名を入力してください';
      }
      if (requiresSetupToken && !setupToken.trim()) {
        return 'セットアップ用の合言葉を入力してください';
      }
    }
    return '';
  };

  const goNext = () => {
    const message = validateStep();
    if (message) {
      setErrorMessage(message);
      return;
    }
    setErrorMessage('');
    setStep((prev) => Math.min(STEPS.length - 1, prev + 1));
  };

  const goBack = () => {
    setErrorMessage('');
    setStep((prev) => Math.max(0, prev - 1));
  };

  const handleSubmit = async () => {
    // 二重送信ガード（同一tickの多重クリックを止める。組織が重複作成される主トリガの防止）。
    if (submittingRef.current) {
      return;
    }

    const message = validateStep();
    if (message) {
      setErrorMessage(message);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage('');

    // 送信を中断して再入力可能な状態に戻す（エラー表示＋ボタン再活性化）。
    const fail = (msg: string) => {
      setErrorMessage(msg);
      setIsSubmitting(false);
      submittingRef.current = false;
    };

    try {
      const result = await setupOrganization({
        fullName,
        email,
        password,
        organizationName,
        ...(requiresSetupToken ? { setupToken } : {}),
      });

      if (!result.ok) {
        fail(result.error);
        return;
      }

      // 作成したユーザーでそのままログインして遷移する（ログインはサーバ経由。LoginForm と同じ API）。
      const signedIn = await signInWithPassword(result.data.email, password);
      if (!signedIn.ok) {
        // アカウントは作成済み。自動ログインに失敗した場合はログイン画面へ誘導する（画面遷移するので戻さない）。
        router.replace('/login');
        return;
      }

      const nextPath = getSafeRedirectPath(searchParams.get('next'));
      router.replace(signedIn.mfa === 'ok' ? nextPath : mfaRedirectUrl(signedIn.mfa));
      router.refresh();
    } catch {
      // Server Action の reject（通信断など）でボタンが固まらないよう必ず戻す。
      fail('通信に失敗しました。時間をおいて再度お試しください');
    }
  };

  return (
    <AuthFormFrame maxWidthClass="max-w-[520px]">
      <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">Initial setup</div>
      <h1 className="mt-2 font-serif text-[30px] font-semibold tracking-[0.2px]">初期セットアップ</h1>
      <p className="mt-2.5 text-sm leading-relaxed text-text-subtle">
        管理者アカウントと企業を作成します。この設定は最初の1回だけです。
      </p>

      {/* ステップインジケータ */}
      <div className="mt-7 flex gap-2">
        {STEPS.map((label, index) => {
          const active = index <= step;
          return (
            <div key={label} className="flex flex-1 flex-col gap-1.5">
              <span
                className={clsx(
                  'h-1 rounded-full transition-colors',
                  active ? 'bg-primary' : 'bg-bg-subtle',
                )}
              />
              <span
                className={clsx('text-xs', active ? 'font-medium text-primary' : 'text-text-subtle')}
              >
                {index + 1}. {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-7">
        {/* ①アカウント */}
        {step === 0 && (
          <div className="flex flex-col gap-5">
            <AuthField label="氏名" htmlFor="signup-name" icon={<User size={17} strokeWidth={1.8} />}>
              <input
                id="signup-name"
                className={bareInputClass}
                type="text"
                value={fullName}
                autoComplete="name"
                placeholder="例: 山田 太郎"
                onChange={(event) => setFullName(event.target.value)}
              />
            </AuthField>
            <AuthField
              label="メールアドレス"
              htmlFor="signup-email"
              icon={<Mail size={17} strokeWidth={1.8} />}
            >
              <input
                id="signup-email"
                className={bareInputClass}
                type="email"
                value={email}
                autoComplete="email"
                placeholder="you@example.co.jp"
                onChange={(event) => setEmail(event.target.value)}
              />
            </AuthField>
            <AuthField
              label="パスワード"
              htmlFor="signup-password"
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
                id="signup-password"
                className={bareInputClass}
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoComplete="new-password"
                placeholder="••••••••"
                onChange={(event) => setPassword(event.target.value)}
              />
            </AuthField>
          </div>
        )}

        {/* ②企業情報 */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <AuthField
              label="企業名"
              htmlFor="signup-org"
              icon={<Building2 size={17} strokeWidth={1.8} />}
            >
              <input
                id="signup-org"
                className={bareInputClass}
                type="text"
                value={organizationName}
                autoComplete="organization"
                placeholder="例: サンプル株式会社"
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            </AuthField>
            {requiresSetupToken && (
              <AuthField
                label="セットアップ用の合言葉"
                htmlFor="signup-setup-token"
                icon={<Lock size={17} strokeWidth={1.8} />}
              >
                <input
                  id="signup-setup-token"
                  className={bareInputClass}
                  type="password"
                  value={setupToken}
                  autoComplete="off"
                  placeholder="サーバに設定した SETUP_TOKEN の値"
                  onChange={(event) => setSetupToken(event.target.value)}
                />
              </AuthField>
            )}
            <p className="text-sm leading-relaxed text-text-subtle">
              最初の事業年度と「普通株式」を自動で作成します。機関設計や資本金などの会社情報は、あとから入力できます。
            </p>
          </div>
        )}
      </div>

      {errorMessage && (
        <p className="mt-5 text-sm text-danger" role="alert">
          {errorMessage}
        </p>
      )}

      {/* フッター操作 */}
      <div className="mt-7 flex items-center justify-between">
        {step > 0 ? (
          <button type="button" className={outlineBtnClass} onClick={goBack} disabled={isSubmitting}>
            <ArrowLeft size={16} strokeWidth={2} />
            戻る
          </button>
        ) : (
          <span />
        )}

        {step < STEPS.length - 1 ? (
          <button type="button" className={primaryBtnClass} onClick={goNext}>
            次へ
            <ArrowRight size={16} strokeWidth={2.2} />
          </button>
        ) : (
          <button
            type="button"
            className={primaryBtnClass}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? '作成中' : 'セットアップを完了'}
            {!isSubmitting && <ArrowRight size={16} strokeWidth={2.2} />}
          </button>
        )}
      </div>

      <p className="mt-7 text-xs text-text-muted">
        既にアカウントをお持ちの方は{' '}
        <Link href="/login" className="font-medium text-primary hover:text-success">
          ログイン
        </Link>
      </p>
    </AuthFormFrame>
  );
};
