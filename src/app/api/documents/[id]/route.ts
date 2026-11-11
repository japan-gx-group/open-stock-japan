// 文書の情報の変更（PATCH）と削除（DELETE）。管理者・メンバーだけ。ファイルの差し替えはできない（削除して登録し直す）。

import { requireEditor } from '@/lib/authz';
import { denied, fromWriteResult, readJson } from '@/lib/api/respond';
import { deleteDocument, updateDocument } from '@/lib/documents/server';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export const PATCH = async (request: Request, context: Context) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  return fromWriteResult(await updateDocument(check.profile, (await context.params).id, await readJson(request)), 'item');
};

export const DELETE = async (_request: Request, context: Context) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  return fromWriteResult(await deleteDocument(check.profile, (await context.params).id), 'result');
};
