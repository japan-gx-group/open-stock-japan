import { AuditLogScreen } from '@/features/audit/components/AuditLogScreen.client';
import { requireAuditReader } from '@/features/audit/services/guard.server';
import { recordAuditEvent } from '@/lib/audit/events';
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';

// 監査ログを開いたことの記録は、同じ人につき 10 分に 1 件まで（開き直すたびに記録が増えないように）。
// プロセス内のカウンタなので、複数台で動かすと台数ぶん残り得る。
const viewLogLimiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 10 * 60_000 });

// 監査ログ（操作の記録・アカウントの棚卸し・改ざんの検査）。
// 読めるかどうかはここ（と各 API）で requireAuditReader が確かめる。読めない人には、画面の中で理由だけを出す。
// 未ログインのアクセスは src/proxy.ts がログイン画面へ振り分ける。
export default async function AuditLogPage() {
  const check = await requireAuditReader();
  if (check.ok && viewLogLimiter.consume(check.profile.id)) {
    // だれが監査ログを見たかも残す（CSV への出力と検査は、それぞれの API が別に残す）
    await recordAuditEvent(
      { organizationId: check.profile.organizationId, userId: check.profile.id },
      { action: 'audit_log.view', entityName: 'system_audit_logs' },
    );
  }
  return <AuditLogScreen deniedMessage={check.ok ? null : check.error} />;
}
