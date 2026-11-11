// アカウントの棚卸しの CSV 出力（GET）。アカウントと、受け取られていない招待を 1 つの表にする（区分の列で見分ける）。
// 形式: UTF-8（BOM つき）。日時は日本時間。招待リンクの秘密（token）は含めない。
// 出力したことは、件数つきで監査ログに残す（access_review.export）。

import { badRequest, denied } from '@/lib/api/respond';
import { logger } from '@/lib/logging/logger';
import { recordAudit } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listAccountAccess } from '@/features/audit/services/accounts.server';
import { accountAccessCsvRows, buildCsv } from '@/features/audit/services/csv';
import { fileTimestamp } from '@/features/audit/services/format';
import { requireAuditReader } from '@/features/audit/services/guard.server';

export const runtime = 'nodejs';

export const GET = async () => {
  const check = await requireAuditReader();
  if (!check.ok) return denied(check);

  const admin = createAdminClient();
  let data;
  try {
    data = await listAccountAccess(admin, check.profile.organizationId);
  } catch (error) {
    logger.error({ error }, 'アカウントの棚卸しの CSV 出力に失敗しました');
    return badRequest('アカウントの一覧の出力に失敗しました', 500);
  }

  await recordAudit(admin, check.profile, 'access_review.export', 'profiles', null, {
    accountCount: data.accounts.length,
    inviteCount: data.invites.length,
  });

  return new Response(buildCsv(accountAccessCsvRows(data)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="access-review_${fileTimestamp()}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Audit-Row-Count': String(data.accounts.length + data.invites.length),
    },
  });
};
