// ログイン不要の期限つき共有リンク（GET: 文書ごとの一覧 / POST: 作成）。管理者・メンバーだけ。
// GET: ?documentId=<uuid>
// POST の本文（JSON）: { documentId, label?, expiresInDays?（1〜90。既定 14） }
// 作成の応答にだけトークン（token）が含まれる。保存されるのはハッシュだけなので、あとから取り出すことはできない。

import { NextResponse } from 'next/server';
import { requireEditor } from '@/lib/authz';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { createShareLink, listShareLinks } from '@/lib/sharing/server';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const GET = async (request: Request) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  const documentId = new URL(request.url).searchParams.get('documentId') ?? '';
  try {
    const items = await listShareLinks(check.profile.organizationId, documentId);
    if (!items) return badRequest('文書が見つかりません', 404);
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch {
    return badRequest('共有リンクの取得に失敗しました', 500);
  }
};

export const POST = async (request: Request) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  const result = await createShareLink(check.profile, await readJson(request));
  if (!result.ok) {
    return NextResponse.json({ error: result.error, fieldErrors: result.fieldErrors ?? {} }, { status: result.status });
  }
  return NextResponse.json({ item: result.data.link, token: result.data.token }, { status: 201, headers: NO_STORE });
};
