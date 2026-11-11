// 業務データの汎用 API（更新・削除）。更新は全項目の置き換え（登録と同じ本文）。

import { requireEditor } from '@/lib/authz';
import { badRequest, denied, fromWriteResult, readJson } from '@/lib/api/respond';
import { isResourceName } from '@/lib/resources/definitions';
import { deleteResource, updateResource } from '@/lib/resources/server';

export const runtime = 'nodejs';

type Context = { params: Promise<{ resource: string; id: string }> };

export const PATCH = async (request: Request, context: Context) => {
  const { resource, id } = await context.params;
  if (!isResourceName(resource)) return badRequest('対象が見つかりません', 404);
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  return fromWriteResult(await updateResource(resource, check.profile, id, await readJson(request)), 'item');
};

export const DELETE = async (_request: Request, context: Context) => {
  const { resource, id } = await context.params;
  if (!isResourceName(resource)) return badRequest('対象が見つかりません', 404);
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  return fromWriteResult(await deleteResource(resource, check.profile, id), 'result');
};
