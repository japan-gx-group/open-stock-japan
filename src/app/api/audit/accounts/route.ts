// アカウントの棚卸し（GET）。組織のすべてのアカウント（株主のアカウントを含む）と、受け取られていない招待の一覧。
// 応答: { accounts, invites, generatedAt }
//   accounts … { id, email, fullName, role, stakeholderId, stakeholderName, createdAt, lastSignInAt, mfaFactorCount, bannedUntil, status }
//   invites  … { email, role, stakeholderId, stakeholderName, invitedByUserId, invitedByName, createdAt, expiresAt, isExpired }
// 招待リンクの秘密（token）は返さない。

import { NextResponse } from 'next/server';
import { badRequest, denied } from '@/lib/api/respond';
import { logger } from '@/lib/logging/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { listAccountAccess } from '@/features/audit/services/accounts.server';
import { requireAuditReader } from '@/features/audit/services/guard.server';

export const runtime = 'nodejs';

export const GET = async () => {
  const check = await requireAuditReader();
  if (!check.ok) return denied(check);
  try {
    const data = await listAccountAccess(createAdminClient(), check.profile.organizationId);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error({ error }, 'アカウントの棚卸しの一覧の取得に失敗しました');
    return badRequest('アカウントの一覧の取得に失敗しました', 500);
  }
};
