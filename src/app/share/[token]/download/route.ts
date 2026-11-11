// 共有リンクからのダウンロード（GET・ログイン不要）。
//
// touch_share_link（有効性の確認とアクセス回数の加算を 1 文で行う RPC）を通ったときだけ、
// 短時間有効な署名つき URL へリダイレクトする。無効・期限切れ・取り消し済み・存在しないトークンは
// 区別せず、同じ「無効」の画面（/share/<token>。404）へ送る。
//
// GET にしている理由: 既存の /api/documents/<id>/download と同じ「確認してリダイレクト」の形にそろえるため。
// POST のフォーム送信にすると、リダイレクト先（Storage の別オリジン）が CSP の form-action 'self' に反する
// （いまは Report-Only だが、強制に切り替えるとダウンロードできなくなる）。GET の副作用はアクセス回数の加算だけで、
// 共有ページの表示では回数を進めず、リンクには nofollow を付け、検索エンジンには noindex を返している。

import { NextResponse } from 'next/server';
import { consumeShareLookupQuota, SHARE_LOOKUP_WINDOW_SECONDS } from '@/lib/sharing/rateLimit';
import { consumeShareLink } from '@/lib/sharing/server';
import { isShareTokenFormat } from '@/lib/sharing/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

export const GET = async (request: Request, context: { params: Promise<{ token: string }> }) => {
  if (!consumeShareLookupQuota(request.headers)) {
    return new NextResponse('アクセスが集中しています。しばらく待ってからお試しください。', {
      status: 429,
      headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(SHARE_LOOKUP_WINDOW_SECONDS) },
    });
  }
  const { token } = await context.params;
  const url = await consumeShareLink(token).catch(() => null);
  if (!url) {
    // 形が正しいトークンだけ共有ページへ戻す（そこで同じ「無効」の画面になる）。形が違えばその場で 404
    if (!isShareTokenFormat(token)) {
      return new NextResponse('リンクが無効か、期限が切れています。', {
        status: 404,
        headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return new NextResponse(null, { status: 303, headers: { ...HEADERS, Location: `/share/${token}` } });
  }
  return new NextResponse(null, { status: 302, headers: { ...HEADERS, Location: url } });
};
