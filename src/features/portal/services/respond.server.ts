// /api/external-portal/** の共通の入口（サーバ専用）。ログイン中の本人を確かめ、応答はキャッシュさせない。
import 'server-only';
import { NextResponse } from 'next/server';
import { SIGNED_OUT_MESSAGE } from '@/lib/authz';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import type { PortalViewer } from './portal.server';

const HEADERS = { 'Cache-Control': 'no-store' };

/**
 * 株主（と、プレビューする社内の人）向けの読み取り。組織・権利者はリクエストからは受け取らず、
 * ログイン中のプロフィールから決める。
 */
export const portalJson = async <T>(load: (viewer: PortalViewer) => Promise<T | null>): Promise<NextResponse> => {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: SIGNED_OUT_MESSAGE }, { status: 401, headers: HEADERS });
  try {
    const data = await load(profile);
    if (data == null) return NextResponse.json({ error: '見つかりません' }, { status: 404, headers: HEADERS });
    return NextResponse.json(data, { headers: HEADERS });
  } catch (error) {
    (await getRequestLogger()).error({ error }, '株主ポータルのデータ取得に失敗しました');
    return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500, headers: HEADERS });
  }
};
