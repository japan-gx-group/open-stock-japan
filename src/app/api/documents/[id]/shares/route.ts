// 文書の公開範囲と、公開先の株主（GET: 読む / PUT: まとめて置き換える）。管理者・メンバーだけ。
// PUT の本文（JSON）: { visibility: 'internal' | 'shareholders' | 'restricted', stakeholderIds?: string[] }

import { NextResponse } from 'next/server';
import { requireEditor } from '@/lib/authz';
import { badRequest, denied, fromWriteResult, readJson } from '@/lib/api/respond';
import { getDocumentSharing, setDocumentSharing } from '@/lib/sharing/server';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export const GET = async (_request: Request, context: Context) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  try {
    const sharing = await getDocumentSharing(check.profile.organizationId, (await context.params).id);
    if (!sharing) return badRequest('文書が見つかりません', 404);
    return NextResponse.json({ sharing });
  } catch {
    return badRequest('公開先の取得に失敗しました', 500);
  }
};

export const PUT = async (request: Request, context: Context) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  return fromWriteResult(await setDocumentSharing(check.profile, (await context.params).id, await readJson(request)), 'sharing');
};
