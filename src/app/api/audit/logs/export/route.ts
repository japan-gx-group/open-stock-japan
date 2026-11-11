// 監査ログの CSV 出力（GET）。絞り込みの条件は一覧（/api/audit/logs）と同じ。
// 形式: UTF-8（BOM つき）。1 行が 1 件の記録で、新しい順。日時は UTC（ISO 8601・マイクロ秒まで）と日本時間の 2 列。
//   連番・ハッシュ・直前のハッシュ・変更前後の値（DB が持つ JSON の文字のまま）を含むので、CSV からハッシュを計算し直せる。
// 上限は EXPORT_MAX_ROWS 行。超えた分は出さず、応答のヘッダで知らせる（期間を区切って出力してもらう）。
//   X-Audit-Row-Count … 出力した行数 / X-Audit-Total-Count … 条件に合う件数
//   X-Audit-Truncated … 上限で打ち切ったら true / X-Audit-Max-Rows … 上限
// 出力したことは、条件・行数・最後の連番とハッシュつきで監査ログに残す（audit_log.export）。
// 記録を書いてから本文を返すので、「記録の無い出力」は起きない。

import { badRequest, denied } from '@/lib/api/respond';
import { logger } from '@/lib/logging/logger';
import { recordAudit } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { EXPORT_MAX_ROWS, parseAuditLogFilters } from '@/features/audit/services/filters';
import { fileTimestamp } from '@/features/audit/services/format';
import { requireAuditReader } from '@/features/audit/services/guard.server';
import { AuditLogQueryError, exportAuditLogs } from '@/features/audit/services/logs.server';

export const runtime = 'nodejs';

export const GET = async (request: Request) => {
  const check = await requireAuditReader();
  if (!check.ok) return denied(check);

  const filters = parseAuditLogFilters(new URL(request.url).searchParams);
  if (!filters.ok) return badRequest(filters.error);

  const admin = createAdminClient();
  let result;
  try {
    result = await exportAuditLogs(admin, check.profile.organizationId, filters.value);
  } catch (error) {
    logger.error({ error }, '監査ログの CSV 出力に失敗しました');
    return badRequest(error instanceof AuditLogQueryError ? error.message : '監査ログの出力に失敗しました', 500);
  }

  await recordAudit(admin, check.profile, 'audit_log.export', 'system_audit_logs', null, {
    filters: filters.value,
    rowCount: result.rowCount,
    totalCount: result.totalCount,
    truncated: result.truncated,
    maxRows: EXPORT_MAX_ROWS,
    firstSeq: result.firstSeq,
    lastSeq: result.lastSeq,
    lastHash: result.lastHash,
  });

  const { chunks } = result;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log_${fileTimestamp()}.csv"`,
      'Content-Length': String(result.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Audit-Row-Count': String(result.rowCount),
      'X-Audit-Total-Count': String(result.totalCount),
      'X-Audit-Truncated': String(result.truncated),
      'X-Audit-Max-Rows': String(EXPORT_MAX_ROWS),
    },
  });
};
