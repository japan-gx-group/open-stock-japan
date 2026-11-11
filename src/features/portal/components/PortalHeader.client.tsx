'use client';

// 株主ポータルのヘッダー（会社名・ナビ・ログイン中の人・ログアウト）。
// 社内の画面のサイドバーとは別物で、株主に見せてよい導線だけを置く。

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, ShieldCheck } from 'lucide-react';
import { OpenStockMark } from '@/components/ui/OpenStockMark';
import { createClient } from '@/lib/supabase/client';

const NAV = [
  { path: '/external-portal', label: 'ホーム' },
  { path: '/external-portal/updates', label: 'お知らせ' },
  { path: '/external-portal/financials', label: '決算情報' },
  { path: '/external-portal/documents', label: '文書' },
  { path: '/external-portal/holdings', label: '保有状況' },
] as const;

const isActive = (pathname: string, path: string): boolean =>
  path === '/external-portal' ? pathname === '/external-portal' : pathname === path || pathname.startsWith(`${path}/`);

export const PortalHeader = ({
  companyName,
  userName,
  isPreview,
}: {
  companyName: string;
  userName: string;
  /** 社内の人がプレビューとして開いている */
  isPreview: boolean;
}) => {
  const pathname = usePathname();
  const router = useRouter();

  // サイドバー（src/components/layout/Sidebar.client.tsx）のログアウトと同じ手順
  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  return (
    <header className="bg-bg-card border-b border-border">
      {isPreview && (
        <div className="bg-warning-soft text-warning text-[12.5px] font-medium px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span>社内ユーザーとしてプレビュー中 — 株主に公開されている内容だけを表示しています（保有状況は株主本人にだけ表示されます）</span>
          <Link href="/dashboard" className="underline text-warning">
            社内の画面に戻る
          </Link>
        </div>
      )}
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between gap-4 pt-4 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <OpenStockMark size={32} className="shrink-0" />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-text-heading truncate">{companyName || '株主ポータル'}</div>
              <div className="text-[11.5px] text-text-muted">株主ポータル</div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-[12.5px] text-text-muted truncate max-w-[220px]">{userName}</span>
            {/* 株主のアカウントも、認証アプリによる二要素認証を設定できる（設定の画面は社内と共通） */}
            {!isPreview && (
              <Link
                href="/mfa/setup"
                className="gt-btn no-underline"
                style={{ height: '34px' }}
                title="ログインのときに、認証アプリの 6 桁のコードも確かめるようにします"
              >
                <ShieldCheck size={14} />
                <span className="hidden sm:inline">二要素認証</span>
              </Link>
            )}
            <button type="button" className="gt-btn" style={{ height: '34px' }} onClick={handleSignOut}>
              <LogOut size={14} />
              ログアウト
            </button>
          </div>
        </div>
        <nav aria-label="株主ポータル" className="flex gap-1 overflow-x-auto -mb-px">
          {NAV.map((item) => {
            const active = isActive(pathname, item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                aria-current={active ? 'page' : undefined}
                className={`px-3 py-2 text-[13px] whitespace-nowrap border-b-2 no-underline ${
                  active ? 'border-primary text-primary font-semibold' : 'border-transparent text-text-muted hover:text-text-main'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
