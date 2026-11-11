import { redirect } from 'next/navigation';
import { MfaSetupScreen } from '@/features/auth/components/MfaSetupScreen.client';
import { mfaRedirectUrl } from '@/features/auth/utils/mfaState';
import { getPostMfaPath } from '@/features/auth/utils/redirect';
import { getSessionState } from '@/lib/sessionState';
import { isShareholder } from '@/types/role';

// セッションごとに内容が変わるため、常にリクエスト時に描画する。
export const dynamic = 'force-dynamic';

export const metadata = { title: '二要素認証の設定 | OpenStock Japan', robots: { index: false, follow: false } };

// 二要素認証の登録・設定。
// 未ログインの人は src/proxy.ts が /login へ送る。ここでは、ログイン中の人の状態で振り分ける:
//   必須なのに未登録（enroll）… 登録の手順を出す（済むまで、ほかの画面・API は使えない）
//   確認がまだ（challenge）   … 先にコードの入力へ（登録・解除は、確認済みのセッションからだけ）
//   済んでいる（ok）          … 自分の二要素認証の設定（登録・予備の機器の追加・解除）。全ロールが使える
export default async function MfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const nextParam = typeof next === 'string' ? next : null;

  const session = await getSessionState();
  if (!session.user) {
    redirect('/login');
  }
  const nextPath = getPostMfaPath(nextParam, isShareholder(session.profile?.role));
  if (session.mfa === 'challenge') {
    redirect(mfaRedirectUrl('challenge', '/mfa/setup'));
  }

  return (
    <MfaSetupScreen
      mode={session.mfa === 'enroll' ? 'required' : 'manage'}
      nextPath={nextPath}
      email={session.user.email}
    />
  );
}
