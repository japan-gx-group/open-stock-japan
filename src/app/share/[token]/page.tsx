// ログイン不要の共有リンクの画面（/share/<token>）。
//
// - トークンの SHA-256 で共有リンクを引く（ここではアクセス回数を進めない。進めるのはダウンロード時）。
// - 無効・期限切れ・取り消し済み・存在しない・回数制限のどれも、同じ「無効」の画面（HTTP 404）にする。
// - 出すのは会社名・文書名・ファイル名・サイズ・期限だけ。組織のほかの情報へは辿れない。
// - 検索エンジンに載せない（noindex）。Referer にトークンを載せない（no-referrer。proxy でもヘッダを付けている）。

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Download, FileText } from 'lucide-react';
import { formatBytes, formatDateTimeJa } from '@/features/library/services/format';
import { consumeShareLookupQuota } from '@/lib/sharing/rateLimit';
import { lookupShareLink } from '@/lib/sharing/server';
import { ShareShell } from './ShareShell';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '共有された文書 | OpenStock Japan',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noarchive: true } },
  referrer: 'no-referrer',
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!consumeShareLookupQuota(await headers())) notFound();
  const share = await lookupShareLink(token).catch(() => null);
  if (!share) notFound();

  return (
    <ShareShell>
      <p className="text-[12px] font-medium text-text-muted m-0">{share.organizationName} から共有された文書</p>
      <h1 className="text-[18px] font-semibold text-text-heading mt-1 mb-0 break-words">{share.title}</h1>
      <div className="flex items-start gap-3 rounded-md border border-border bg-bg-subtle px-4 py-3 mt-5">
        <FileText size={18} className="mt-[2px] shrink-0 text-text-muted" />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-text-main break-all">{share.fileName}</div>
          <div className="text-[12px] text-text-muted mt-[2px]">{formatBytes(share.sizeBytes)}</div>
        </div>
      </div>
      {/* 別オリジン（Storage）へのリダイレクトなので、通常のリンクにする（Next の Link による先読みをさせない） */}
      <a
        href={`/share/${token}/download`}
        rel="nofollow noreferrer"
        className="gt-btn-primary w-full mt-5 no-underline"
        style={{ justifyContent: 'center', height: '40px' }}
      >
        <Download size={16} />
        ダウンロード
      </a>
      <p className="text-[12px] leading-relaxed text-text-muted mt-4 mb-0">
        このリンクの有効期限: <span className="whitespace-nowrap">{formatDateTimeJa(share.expiresAt)}</span>（日本時間）まで。
        リンクを知っている人は誰でもこの文書を取得できます。第三者に転送しないでください。
      </p>
    </ShareShell>
  );
}
