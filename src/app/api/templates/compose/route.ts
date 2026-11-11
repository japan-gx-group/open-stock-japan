// テンプレートから文書を作る（POST）。社内の全員（閲覧のみ・監査人も、登録済みの内容から文書を作って読める）。
// 本文（JSON）: { templateId, subjectId?, investmentId? }
// 差し込み項目を台帳の値に置き換えた文面を返す。AI は使わない。文書は保存しない。

import { NextResponse } from 'next/server';
import { requireInternal } from '@/lib/authz';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { composeDocument } from '@/features/templates/services/compose.server';

export const runtime = 'nodejs';

export const POST = async (request: Request) => {
  const check = await requireInternal();
  if (!check.ok) return denied(check);
  const body = (await readJson(request)) as { templateId?: unknown; subjectId?: unknown; investmentId?: unknown } | null;
  const result = await composeDocument(check.profile, {
    templateId: body?.templateId,
    subjectId: body?.subjectId,
    investmentId: body?.investmentId,
  });
  if (!result.ok) return badRequest(result.error, result.status);
  return NextResponse.json({ document: result.data }, { headers: { 'Cache-Control': 'no-store' } });
};
