// 文書を保存して AI で読み取る（POST）。管理者・メンバーだけ。
// 本文は multipart/form-data: file（必須）、documentKind（文書の種類。'auto' は AI が判定）、title（任意）。
// ファイルは文書ライブラリ（社内のみ）に保存する。4MB を超えるファイルは保存だけして AI には送らない。
// 読取りが失敗しても文書は残し、応答の document.id で POST /api/import/<文書の id>/retry からもう一度読み取れる。

import { requireEditor } from '@/lib/authz';
import { badRequest, denied } from '@/lib/api/respond';
import { MAX_DOCUMENT_BYTES } from '@/lib/documents/server';
import { isImportDocumentKind } from '@/lib/import/groups';
import { fromImportResult } from '@/lib/import/respond';
import { extractFromUpload } from '@/lib/import/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const READABLE_EXTENSIONS = /\.(pdf|png|jpe?g|webp|txt)$/i;

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
  if (!(file instanceof File) || file.size === 0) return badRequest('ファイルを選んでください');
  if (file.size > MAX_DOCUMENT_BYTES) return badRequest('ファイルは 20MB までです');
  if (!READABLE_EXTENSIONS.test(file.name)) return badRequest('AI で読み取れるのは PDF、画像（PNG・JPEG・WebP）、テキストのファイルです');
  const documentKind = String(form.get('documentKind') ?? '');
  if (documentKind !== 'auto' && !isImportDocumentKind(documentKind)) return badRequest('文書の種類を選んでください');
  const title = form.get('title');

  const result = await extractFromUpload(check.profile, {
    fileName: file.name,
    data: new Uint8Array(await file.arrayBuffer()),
    documentKind,
    title: typeof title === 'string' && title.trim() !== '' ? title.trim().slice(0, 200) : undefined,
    signal: request.signal,
  });
  return fromImportResult(result, 201);
};
