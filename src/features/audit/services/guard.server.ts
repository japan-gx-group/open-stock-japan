// 監査ログ・アカウントの棚卸しを読める人かどうかを確かめる（サーバ専用）。
//
// 監査ログの画面と /api/audit/** は、必ずこの関数だけを通す。
// 読めるのは管理者と監査人（src/lib/authz.ts の requireAuditReader）。
// 権限の無い人が開こうとしたことは、authz が監査ログに残す（access.denied）。

import 'server-only';

export { AUDIT_READER_ONLY_MESSAGE, requireAuditReader } from '@/lib/authz';
