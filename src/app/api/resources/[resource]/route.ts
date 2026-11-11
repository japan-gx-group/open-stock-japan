// 業務データの汎用 API（一覧・登録）。項目と検証は src/lib/resources/definitions.ts の定義で決まる。
// 読み取りは社内の全員、書き込みは管理者・メンバーだけ。組織はログイン中のプロフィールから取る。

import { NextResponse } from 'next/server';
import { requireEditor, requireInternal } from '@/lib/authz';
import { badRequest, denied, fromWriteResult, readJson } from '@/lib/api/respond';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { isResourceName } from '@/lib/resources/definitions';
import { createResource, listResource } from '@/lib/resources/server';

export const runtime = 'nodejs';

type Context = { params: Promise<{ resource: string }> };

export const GET = async (request: Request, context: Context) => {
  const { resource } = await context.params;
  if (!isResourceName(resource)) return badRequest('対象が見つかりません', 404);
  const check = await requireInternal();
  if (!check.ok) return denied(check);
  try {
    const filters = Object.fromEntries(new URL(request.url).searchParams.entries());
    const items = await listResource(resource, check.profile.organizationId, filters);
    return NextResponse.json({ items });
  } catch (error) {
    (await getRequestLogger()).error({ error, resource }, '業務データの取得に失敗しました');
    return badRequest('データの取得に失敗しました', 500);
  }
};

export const POST = async (request: Request, context: Context) => {
  const { resource } = await context.params;
  if (!isResourceName(resource)) return badRequest('対象が見つかりません', 404);
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  return fromWriteResult(await createResource(resource, check.profile, await readJson(request)), 'item', 201);
};
