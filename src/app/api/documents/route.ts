// 文書ライブラリ（GET: 一覧 / POST: アップロード）。一覧は社内の全員、アップロードは管理者・メンバー。
// POST の本文は multipart/form-data: file（必須）、title・category・description・documentDate・visibility・entityType・entityId（任意）。

import { NextResponse } from 'next/server';
import { requireEditor, requireInternal } from '@/lib/authz';
import { badRequest, denied, fromWriteResult } from '@/lib/api/respond';
import { listDocuments, MAX_DOCUMENT_BYTES, uploadDocument } from '@/lib/documents/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = async (request: Request) => {
  const check = await requireInternal();
  if (!check.ok) return denied(check);
  const params = new URL(request.url).searchParams;
  try {
    const items = await listDocuments(check.profile.organizationId, {
      category: params.get('category') ?? undefined,
      entityType: params.get('entityType') ?? undefined,
      entityId: params.get('entityId') ?? undefined,
    });
    return NextResponse.json({ items });
  } catch {
    return badRequest('文書の取得に失敗しました', 500);
  }
};

export const POST = async (request: Request) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest('入力内容が不正です');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return badRequest('ファイルを選んでください');
  if (file.size > MAX_DOCUMENT_BYTES) return badRequest('ファイルは 20MB までです');
  const text = (key: string): string | undefined => {
    const value = form.get(key);
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  const result = await uploadDocument(check.profile, {
    fileName: file.name,
    data: new Uint8Array(await file.arrayBuffer()),
    title: text('title'),
    category: text('category'),
    description: text('description'),
    documentDate: text('documentDate'),
    visibility: text('visibility'),
    entityType: text('entityType') ?? null,
    entityId: text('entityId') ?? null,
  });
  return fromWriteResult(result, 'item', 201);
};
