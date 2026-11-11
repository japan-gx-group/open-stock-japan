// ブラウザの中で完結する操作（Excel への出力・印刷）の記録（POST）。社内の人だけ。
// 本文（JSON）: { kind, detail? }。kind は src/lib/audit/activity.ts の種類に限る。
// 記録できたときだけ 201 を返し、ブラウザはそれを見てから出力する（src/lib/audit/activityClient.ts）。

import { NextResponse } from 'next/server';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { isActivityKind, sanitizeActivityDetail } from '@/lib/audit/activity';
import { recordAuditEvent } from '@/lib/audit/events';
import { requireInternal } from '@/lib/authz';
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';

export const runtime = 'nodejs';

// 1 人が 1 分に残せる件数。出力・印刷は人が押す操作なので、これを超えるのは画面からの操作ではない。
// 監査ログは追記専用で消せないので、際限なく増やさせない（プロセス内のカウンタ）。
const ACTIVITY_LIMIT_PER_MINUTE = 20;
const activityLimiter = createFixedWindowRateLimiter({ limit: ACTIVITY_LIMIT_PER_MINUTE, windowMs: 60_000 });

export const POST = async (request: Request) => {
  const check = await requireInternal();
  if (!check.ok) return denied(check);

  const body = (await readJson(request)) as { kind?: unknown; detail?: unknown } | null;
  if (!isActivityKind(body?.kind)) return badRequest('記録する操作の種類が正しくありません');
  if (!activityLimiter.consume(check.profile.id)) {
    return badRequest('短い時間に何度も出力しています。少し待ってからもう一度お試しください', 429);
  }

  const detail = sanitizeActivityDetail(body?.detail);
  const recorded = await recordAuditEvent(
    { organizationId: check.profile.organizationId, userId: check.profile.id },
    { action: body.kind, entityName: 'export', entityId: detail.entityId ?? null, detail: { ...detail } },
  );
  if (!recorded) return badRequest('記録に失敗しました', 500);
  return NextResponse.json({ ok: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
};
