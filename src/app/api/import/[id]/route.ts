// 1 件の読取りの結果（GET）。今の台帳との照合をやり直して返す。社内の全員が読める。

import { NextResponse } from 'next/server';
import { requireInternal } from '@/lib/authz';
import { badRequest, denied } from '@/lib/api/respond';
import { getExtraction } from '@/lib/import/server';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export const GET = async (_request: Request, context: Context) => {
  const check = await requireInternal();
  if (!check.ok) return denied(check);
  try {
    const response = await getExtraction(check.profile, (await context.params).id);
    return response ? NextResponse.json(response) : badRequest('読取りの結果が見つかりません', 404);
  } catch {
    return badRequest('読取りの結果の取得に失敗しました', 500);
  }
};
