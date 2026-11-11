import { redirect } from 'next/navigation';
import { MfaChallengeForm } from '@/features/auth/components/MfaChallengeForm.client';
import { mfaRedirectUrl } from '@/features/auth/utils/mfaState';
import { getPostMfaPath } from '@/features/auth/utils/redirect';
import { getSessionState } from '@/lib/sessionState';
import { isShareholder } from '@/types/role';

// セッションごとに内容が変わるため、常にリクエスト時に描画する。
export const dynamic = 'force-dynamic';

export const metadata = { title: '二要素認証 | OpenStock Japan', robots: { index: false, follow: false } };

// ログイン時の二要素認証（コードの入力）。
// 未ログインの人は src/proxy.ts が /login へ送る。ここでは、ログイン中の人の状態で振り分ける:
//   確認がまだ（challenge）… コードの入力を出す
//   もう済んでいる（ok）    … 元の行き先（next）へ
//   必須なのに未登録（enroll）… 登録の画面へ
export default async function MfaPage({
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
  const nextPath = getPostMfaPath(nextParam, isShareholder(session.profile?.role), { allowSetup: true });
  if (session.mfa === 'ok') {
    redirect(nextPath);
  }
  if (session.mfa === 'enroll') {
    redirect(mfaRedirectUrl('enroll', nextParam ? nextPath : null));
  }

  return <MfaChallengeForm nextPath={nextPath} email={session.user.email} />;
}
