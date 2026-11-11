// 監査ログの 1 行の詳細（GET）。変更前後の値・ハッシュ・ブラウザの情報まで含めて返す。
// 応答: { item }。自組織の記録でなければ 404。

import { NextResponse } from 'next/server';
import { badRequest, denied } from '@/lib/api/respond';
import { logger } from '@/lib/logging/logger';
import { isUuid } from '@/lib/resources/fields';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuditReader } from '@/features/audit/services/guard.server';
import { getAuditLogDetail } from '@/features/audit/services/logs.server';

export const runtime = 'nodejs';

export const GET = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const check = await requireAuditReader();
  if (!check.ok) return denied(check);
  const { id } = await context.params;
  if (!isUuid(id)) return badRequest('記録の指定が正しくありません');
  try {
    const item = await getAuditLogDetail(createAdminClient(), check.profile.organizationId, id);
    if (!item) return badRequest('記録が見つかりません', 404);
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error({ error }, '監査ログの詳細の取得に失敗しました');
    return badRequest('監査ログの取得に失敗しました', 500);
  }
};
