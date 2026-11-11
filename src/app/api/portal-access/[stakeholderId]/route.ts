// 株主ポータルの利用の取り消し（DELETE）。管理者だけ。
// 未受諾の招待を取り消す。アカウント作成済みなら、その株主のアカウント（株主ロールだけ）を削除する。

import { revokePortalAccess } from '@/features/portal-access/services/portalAccess.server';
import { requireAdmin } from '@/lib/authz';
import { denied, fromWriteResult } from '@/lib/api/respond';

export const runtime = 'nodejs';

export const DELETE = async (_request: Request, context: { params: Promise<{ stakeholderId: string }> }) => {
  const check = await requireAdmin();
  if (!check.ok) return denied(check);
  return fromWriteResult(await revokePortalAccess(check.profile, (await context.params).stakeholderId), 'result');
};
