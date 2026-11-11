'use client';

// 二要素認証の登録・設定の画面（/mfa/setup）。2 つの場面で使う。
//   required … 組織が社内のアカウントに必須にしているのに、まだ登録していない人。登録が済むまで先へ進めない
//   manage   … 登録・解除を自分で行う画面（全ロール。株主ロールはアカウント設定の画面が無いので、ここを使う）
// 登録・解除の処理と強制は、サーバ（src/features/settings/services/mfa.ts・getCurrentProfile）が行う。

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AuthFormFrame } from '@/features/auth/components/AuthFormFrame';
import { MfaEnrollPanel } from '@/features/settings/components/MfaEnrollPanel.client';
import { MfaSettings } from '@/features/settings/components/MfaSettings.client';

interface MfaSetupScreenProps {
  mode: 'required' | 'manage';
  /** 済んだあと（または「戻る」）で進む先。サーバが安全な相対パスに直したもの */
  nextPath: string;
  email: string | null;
}

export const MfaSetupScreen = ({ mode, nextPath, email }: MfaSetupScreenProps) => {
  const router = useRouter();
  const [notice, setNotice] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const showNotice = (message: string, type: 'success' | 'error') => {
    if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
    setNotice({ message, type });
    noticeTimerRef.current = setTimeout(() => setNotice(null), 6000);
  };

  // この端末のセッションだけを終える
  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  };

  const signOutButton = (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="w-fit text-[13px] font-medium text-primary transition-colors hover:text-success disabled:opacity-60"
    >
      ログアウト
    </button>
  );

  if (mode === 'required') {
    return (
      <AuthFormFrame maxWidthClass="max-w-[520px]">
        <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">Two-factor authentication</div>
        <h1 className="mt-2 font-serif text-[30px] font-semibold tracking-[0.2px]">二要素認証の登録</h1>
        <p className="mb-6 mt-2.5 text-sm leading-relaxed text-text-subtle">
          この組織では、社内のアカウントに二要素認証が必須です。認証アプリを登録すると、続きの画面を開けます。
          {email && (
            <>
              <br />
              <span className="text-text-heading">{email}</span> としてログイン中です。
            </>
          )}
        </p>
        <MfaEnrollPanel
          defaultName="認証アプリ"
          onCompleted={() => {
            router.replace(nextPath);
            router.refresh();
          }}
        />
        <p className="mt-6 text-xs leading-relaxed text-text-muted">
          リカバリーコード（予備のコード）はありません。登録のあと、アカウント設定から予備の機器をもう1台登録しておくことをおすすめします。
        </p>
        <div className="mt-4">{signOutButton}</div>
      </AuthFormFrame>
    );
  }

  return (
    <AuthFormFrame maxWidthClass="max-w-[560px]">
      <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">Two-factor authentication</div>
      <h1 className="mt-2 font-serif text-[30px] font-semibold tracking-[0.2px]">二要素認証の設定</h1>
      <p className="mb-6 mt-2.5 text-sm leading-relaxed text-text-subtle">
        {email && (
          <>
            <span className="text-text-heading">{email}</span> のログインを、認証アプリのコードで守ります。
          </>
        )}
      </p>
      {notice && (
        <p className={`mb-4 text-sm ${notice.type === 'success' ? 'text-primary' : 'text-danger'}`} role={notice.type === 'success' ? 'status' : 'alert'}>
          {notice.message}
        </p>
      )}
      <MfaSettings showToast={showNotice} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <Link href={nextPath} className="flex items-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:text-success">
          <ArrowLeft size={15} strokeWidth={2} />
          戻る
        </Link>
        {signOutButton}
      </div>
    </AuthFormFrame>
  );
};
