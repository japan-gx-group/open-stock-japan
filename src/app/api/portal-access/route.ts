// 株主ポータルの利用状況（GET）。社内の全員が読める。
// 応答: { items: { [stakeholderId]: { status: 'none' | 'invited' | 'active', invitedAt?, expiresAt?, isExpired?, inviteUrl? } } }
// 招待リンク（inviteUrl）は管理者にだけ返す。

import { NextResponse } from 'next/server';
import { listPortalAccess, resolveOrigin } from '@/features/portal-access/services/portalAccess.server';
import { requireInternal } from '@/lib/authz';
import { badRequest, denied } from '@/lib/api/respond';
import { isAdmin } from '@/types/role';

export const runtime = 'nodejs';

export const GET = async (request: Request) => {
  const check = await requireInternal();
  if (!check.ok) return denied(check);
  try {
    const items = await listPortalAccess(check.profile.organizationId, {
      includeLinks: isAdmin(check.profile.role),
      origin: resolveOrigin(request.headers),
    });
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return badRequest('株主ポータルの利用状況の取得に失敗しました', 500);
  }
};
