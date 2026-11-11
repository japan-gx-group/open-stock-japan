import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSetupState, getSetupTokenStatus } from '@/features/auth/services/setup';
import { AuthFormFrame } from '@/features/auth/components/AuthFormFrame';
import { SETUP_TOKEN_MISSING_MESSAGE } from '@/features/auth/types';
import { SignupWizard } from '@/features/auth/components/SignupWizard.client';

// admin client（service_role）で組織有無を確認するため、ビルド時の事前生成を避けて
// 常にリクエスト時に実行する。
export const dynamic = 'force-dynamic';

// 初回登録ウィザード（初期セットアップ）。
// 自社ホスト・単一テナント前提のため、既にセットアップ済み（組織が存在する）なら
// このページは開かせず /login へ送る。
export default async function SignupPage() {
  const setupState = await getSetupState();
  if (setupState === 'completed') {
    redirect('/login?setup=done');
  }
  // 判定できなかった場合もウィザードは開かせないが、「セットアップ済み」と同じ案内にすると
  // 環境側の異常（接続設定の誤りなど）が誰にも気づかれないため、別の案内へ送る。
  if (setupState === 'unknown') {
    redirect('/login?setup=error');
  }
  // 本番では、セットアップ用の合言葉（SETUP_TOKEN）が無いと登録させない。
  // 設定を忘れたまま公開しても、最初に来た人が管理者になることが無いようにするため。
  const tokenStatus = await getSetupTokenStatus();
  if (tokenStatus === 'missing') {
    return (
      <AuthFormFrame>
        <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">Setup</div>
        <h1 className="mt-2 font-serif text-[26px] font-semibold leading-[1.3]">初回の登録の準備が要ります</h1>
        <p className="mt-5 text-sm leading-relaxed text-text-main" role="alert">
          {SETUP_TOKEN_MISSING_MESSAGE}
        </p>
        <p className="mt-4 text-xs leading-relaxed text-text-muted">
          合言葉は、この画面で最初の管理者を登録するときに入力します。値は <code>openssl rand -base64 24</code> などで作ってください。
          詳しくは docs/setup-guide.md の「3. 初回セットアップ」にあります。
        </p>
      </AuthFormFrame>
    );
  }

  // SignupWizard は useSearchParams() を使うため Suspense 境界で包む。
  return (
    <Suspense>
      <SignupWizard requiresSetupToken={tokenStatus === 'required'} />
    </Suspense>
  );
}
