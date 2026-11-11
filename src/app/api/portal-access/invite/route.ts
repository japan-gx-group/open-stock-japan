// 株主を株主ポータルに招待する（POST）。管理者だけ。
// 本文（JSON）: { stakeholderId }
// 応答: { inviteUrl, email, expiresAt, emailStatus: 'sent' | 'skipped' | 'failed' }
// メール送信が未設定・失敗のときは、管理者が inviteUrl をコピーして本人に伝える。

import { NextResponse } from 'next/server';
import { inviteShareholder, resolveOrigin } from '@/features/portal-access/services/portalAccess.server';
import { requireAdmin } from '@/lib/authz';
import { denied, readJson } from '@/lib/api/respond';

export const runtime = 'nodejs';

export const POST = async (request: Request) => {
  const check = await requireAdmin();
  if (!check.ok) return denied(check);
  const body = (await readJson(request)) as { stakeholderId?: unknown } | null;
  const result = await inviteShareholder(check.profile, body?.stakeholderId, resolveOrigin(request.headers));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 201, headers: { 'Cache-Control': 'no-store' } });
};
