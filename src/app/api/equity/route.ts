// 株式・新株予約権の台帳一式（GET）。資本政策表・株主名簿・ストックオプションの各画面が、これを 1 回読んで画面側で計算する。

import { NextResponse } from 'next/server';
import { requireInternal } from '@/lib/authz';
import { badRequest, denied } from '@/lib/api/respond';
import { fetchEquitySnapshot } from '@/lib/equity/server';
import { getRequestLogger } from '@/lib/logging/requestLogger';

export const runtime = 'nodejs';

export const GET = async () => {
  const check = await requireInternal();
  if (!check.ok) return denied(check);
  try {
    return NextResponse.json({ snapshot: await fetchEquitySnapshot(check.profile.organizationId) });
  } catch (error) {
    (await getRequestLogger()).error({ error }, '台帳の取得に失敗しました');
    return badRequest('台帳の取得に失敗しました', 500);
  }
};
