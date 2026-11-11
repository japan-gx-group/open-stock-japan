import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { CurrentUserProvider } from '@/contexts/CurrentUserContext.client';
import { AppRefreshProvider } from '@/contexts/AppRefreshContext.client';
import { Sidebar } from '@/components/layout/Sidebar.client';
import { AppTopBar } from '@/components/layout/AppTopBar.client';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getMfaRedirect, getSessionState } from '@/lib/sessionState';
import { isShareholder } from '@/types/role';

// ログイン後の画面はビルド時に事前生成させず、常にリクエスト時に描画する。
// 事前生成されると `Cache-Control: s-maxage=31536000`（max-age なし）で返り、ブラウザが
// HTML をヒューリスティックにキャッシュする。リロードでキャッシュから表示されると
// proxy.ts の認証ガードを通らず、ブラウザ側ではトークン更新が失敗してセッションが消え、
// 全クエリが 401 の空の画面（組織未設定）になる。動的描画なら
// `private, no-cache, no-store` が付き、毎回 proxy.ts を通ってセッション切れは /login へ送られる。
export const dynamic = 'force-dynamic';

// 社内メンバー向け（ログイン後）画面のルートグループ。URL には現れない。
// サイドバー・パンくずバーと、ログイン後にしか意味を持たない Context
// （現在ユーザー / 最新データに更新）はここで 1 回だけ組み立てる。
// 未ログインのアクセスは src/proxy.ts（ミドルウェア）が /login へ振り分けるため、
// このレイアウトに到達した時点でセッションはある前提でよい。
//
// 株主ロール（shareholder）のアカウントは社内の画面を使えないため、株主ポータル（/external-portal）へ送る。
// これは画面の振り分けであり、データの保護はサーバ側の権限チェック
// （src/lib/authz.ts の requireInternal / requireEditor / requireAdmin）と RLS が担う。
//
// 二要素認証がまだの人（コードの確認がまだ = /mfa、必須なのに未登録 = /mfa/setup）は、その画面へ送る。
// これも画面の振り分けで、強制は getCurrentProfile()（API・Server Action が 401 になる）と RLS が行う。
export default async function AppLayout({ children }: { children: ReactNode }) {
  const mfaRedirect = await getMfaRedirect(await getSessionState());
  if (mfaRedirect) {
    redirect(mfaRedirect);
  }

  const profile = await getCurrentProfile();
  if (isShareholder(profile?.role)) {
    redirect('/external-portal');
  }

  return (
    <CurrentUserProvider>
      <AppRefreshProvider>
        <div className="app-root">
          <Sidebar />
          {/* パンくずバーと本文の余白（.page-content）は全画面共通のため layout で1回だけ描く。
              各画面は本文（PageHeading 以降）だけを返し、自分では外側の余白を持たない。 */}
          <main className="main-content">
            <AppTopBar />
            <div className="page-content">{children}</div>
          </main>
        </div>
      </AppRefreshProvider>
    </CurrentUserProvider>
  );
}
