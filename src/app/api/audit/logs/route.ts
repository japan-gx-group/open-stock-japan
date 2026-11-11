// 監査ログの一覧（GET）。読めるのは requireAuditReader を通る人だけ（いまは管理者）。
// 問い合わせ:
//   from, to   … 期間（YYYY-MM-DD。日本時間。終わりの日を含む）
//   source     … app | db | auth        outcome … success | failure | denied
//   userId     … 操作した人の id（'system' は操作した人が決まらない記録）
//   category   … 種類（src/features/audit/services/labels.ts の AUDIT_CATEGORIES、または other）
//   entityName, entityId, requestId … 対象・同じリクエストでの絞り込み
//   q          … キーワード（操作・詳細・メールアドレス・IP アドレス・対象の種類。操作は表示名でも探せる）
//   cursor, limit（1〜200。既定 50）… 連番の降順で、続きを読む
// 応答: { items, nextCursor, total? }（total は最初のページでだけ返す）

import { NextResponse } from 'next/server';
import { badRequest, denied } from '@/lib/api/respond';
import { logger } from '@/lib/logging/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatCursor, parseAuditLogFilters, parseCursor, parsePageSize } from '@/features/audit/services/filters';
import { requireAuditReader } from '@/features/audit/services/guard.server';
import { countAuditLogs, listAuditLogs } from '@/features/audit/services/logs.server';
import type { AuditLogPage } from '@/features/audit/types';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const GET = async (request: Request) => {
  const check = await requireAuditReader();
  if (!check.ok) return denied(check);

  const { searchParams } = new URL(request.url);
  const filters = parseAuditLogFilters(searchParams);
  if (!filters.ok) return badRequest(filters.error);
  const limit = parsePageSize(searchParams);
  if (!limit.ok) return badRequest(limit.error);
  const cursor = parseCursor(searchParams);
  if (!cursor.ok) return badRequest(cursor.error);

  const admin = createAdminClient();
  const { organizationId } = check.profile;
  try {
    const [page, total] = await Promise.all([
      listAuditLogs(admin, organizationId, filters.value, cursor.value, limit.value),
      // 件数は最初のページでだけ数える
      cursor.value ? null : countAuditLogs(admin, organizationId, filters.value),
    ]);
    const body: AuditLogPage = {
      items: page.items,
      nextCursor: page.nextCursor ? formatCursor(page.nextCursor) : null,
      ...(total == null ? {} : { total }),
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    logger.error({ error }, '監査ログの一覧の取得に失敗しました');
    return badRequest('監査ログの取得に失敗しました', 500);
  }
};
