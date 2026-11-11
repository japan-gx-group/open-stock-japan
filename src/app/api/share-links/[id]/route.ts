// 共有リンクの取り消し（DELETE）。管理者・メンバーだけ。行は消さず revokedAt を入れる（アクセスの記録を残す）。

import { requireEditor } from '@/lib/authz';
import { denied, fromWriteResult } from '@/lib/api/respond';
import { revokeShareLink } from '@/lib/sharing/server';

export const runtime = 'nodejs';

export const DELETE = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  return fromWriteResult(await revokeShareLink(check.profile, (await context.params).id), 'item');
};
