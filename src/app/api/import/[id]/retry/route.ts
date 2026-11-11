// 保存済みの文書を、もう一度 AI で読み取る（POST）。管理者・メンバーだけ。
// ここの id は「文書の id」（読取りに失敗したときは読取りの結果の行が無いため）。本文は { documentKind }。
// 成功すると、新しい読取りの結果を 1 件作って返す。

import { requireEditor } from '@/lib/authz';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { isImportDocumentKind } from '@/lib/import/groups';
import { fromImportResult } from '@/lib/import/respond';
import { extractFromDocument } from '@/lib/import/server';
import { isUuid } from '@/lib/resources/fields';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

export const POST = async (request: Request, context: Context) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  const { id } = await context.params;
  if (!isUuid(id)) return badRequest('文書が見つかりません', 404);
  const body = (await readJson(request)) as { documentKind?: unknown } | null;
  const documentKind = typeof body?.documentKind === 'string' ? body.documentKind : '';
  if (documentKind !== 'auto' && !isImportDocumentKind(documentKind)) return badRequest('文書の種類を選んでください');
  return fromImportResult(await extractFromDocument(check.profile, id, documentKind, request.signal), 201);
};
