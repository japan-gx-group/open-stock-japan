import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PortalHeader } from '@/features/portal/components/PortalHeader.client';
import { getPortalCompanyName } from '@/features/portal/services/portal.server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getMfaRedirect, getSessionState } from '@/lib/sessionState';
import { isInternal } from '@/types/role';

// 株主ポータル（/external-portal 配下）のルートグループ。URL には現れない。
// 株主ロールのアカウント向けの画面で、社内の人はプレビューとして開ける（公開済みの内容だけ。保有状況は空）。
// 社内の画面のサイドバー・Context は載せない（株主が読めないデータを取りに行く部品を置かない）。
// データはすべてサーバ（src/features/portal/services/portal.server.ts）が、ログイン中の本人の分だけを返す。

// ログイン中の本人ごとに内容が変わるため、常にリクエスト時に描画する（(app)/layout.tsx と同じ理由）。
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '株主ポータル | OpenStock Japan',
  robots: { index: false, follow: false },
};

export default async function PortalLayout({ children }: { children: ReactNode }) {
  // 二要素認証がまだの人（株主ロールでも、本人が要素を登録していればコードの確認が要る）は、その画面へ送る。
  // 強制は getCurrentProfile()（下で null になる）と、各ページ・API の同じ確認が行う。
  const mfaRedirect = await getMfaRedirect(await getSessionState());
  if (mfaRedirect) redirect(mfaRedirect);

  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const companyName = await getPortalCompanyName(profile);

  return (
    <div className="min-h-screen bg-bg-main flex flex-col">
      <PortalHeader
        companyName={companyName}
        userName={profile.fullName?.trim() || profile.email}
        isPreview={isInternal(profile.role)}
      />
      <main className="flex-1 w-full max-w-[1040px] mx-auto px-4 sm:px-6 py-6">{children}</main>
      <footer className="text-center text-[11.5px] text-text-subtle py-5">
        掲載内容は {companyName || '会社'} が株主のみなさまに向けて公開したものです。第三者への転送はお控えください。
      </footer>
    </div>
  );
}
