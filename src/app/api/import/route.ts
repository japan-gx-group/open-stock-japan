// AI 取り込みの履歴（GET）。社内の全員が読める。

import { NextResponse } from 'next/server';
import { requireInternal } from '@/lib/authz';
import { badRequest, denied } from '@/lib/api/respond';
import { listExtractions } from '@/lib/import/server';

export const runtime = 'nodejs';

export const GET = async () => {
  const check = await requireInternal();
  if (!check.ok) return denied(check);
  try {
    return NextResponse.json({ items: await listExtractions(check.profile) });
  } catch {
    return badRequest('取り込みの履歴の取得に失敗しました', 500);
  }
};
