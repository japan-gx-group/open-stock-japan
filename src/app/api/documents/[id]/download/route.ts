// 文書のダウンロード（GET）。権限を確かめて、短時間だけ有効な署名つき URL へリダイレクトする。
// 社内の人は自組織の文書すべて、株主は自分に公開された文書だけ（src/lib/documents/server.ts の canReadDocument）。

import { NextResponse } from 'next/server';
import { badRequest } from '@/lib/api/respond';
import { getCurrentProfile } from '@/lib/currentProfile';
import { createDownloadUrl } from '@/lib/documents/server';

export const runtime = 'nodejs';

export const GET = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const profile = await getCurrentProfile();
  if (!profile) return badRequest('ログインが必要です', 401);
  const url = await createDownloadUrl(profile, (await context.params).id);
  // 見つからない場合と権限が無い場合を区別しない（文書の有無を漏らさない）
  if (!url) return badRequest('文書が見つかりません', 404);
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
};
