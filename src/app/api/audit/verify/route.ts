// 監査ログの改ざんの検査（POST）。連鎖（連番とハッシュ）を先頭から計算し直して、記録と合うかを確かめる。
// 本文（JSON・省略可）: { anchorSeq, anchorHash } … 以前に控えた連番とハッシュ。いまの記録と同じかも確かめる
// 応答: { result, anchor }
//   result … verify_audit_log_chain の結果（{ ok: true, count, lastSeq, lastHash, legacyCount, checkedAt } または
//            { ok: false, reason, seq, count, expectedSeq? }）
//   anchor … 控えとの突き合わせ（{ seq, found, matches }）。本文で渡さなければ null
// 検査したことと結果は監査ログに残す（audit_log.verify。問題が見つかったときは結果を「失敗」にする）。
// 状態を変える操作ではないが、記録が 1 行増えるので POST にしている。

import { NextResponse } from 'next/server';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { logger } from '@/lib/logging/logger';
import { recordAudit } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuditReader } from '@/features/audit/services/guard.server';
import { parseAnchor, toVerifyResult } from '@/features/audit/services/verify';
import type { AnchorCheckResult, VerifyResponse } from '@/features/audit/types';

export const runtime = 'nodejs';

export const POST = async (request: Request) => {
  const check = await requireAuditReader();
  if (!check.ok) return denied(check);

  const anchorInput = parseAnchor(await readJson(request));
  if (!anchorInput.ok) return badRequest(anchorInput.error);

  const admin = createAdminClient();
  const { organizationId } = check.profile;

  const { data, error } = await admin.rpc('verify_audit_log_chain', { p_organization_id: organizationId });
  const result = error ? null : toVerifyResult(data);
  if (!result) {
    logger.error({ error }, '監査ログの検査に失敗しました');
    return badRequest('監査ログの検査に失敗しました', 500);
  }

  let anchor: AnchorCheckResult | null = null;
  if (anchorInput.value) {
    const { seq, hash } = anchorInput.value;
    const { data: row, error: anchorError } = await admin
      .from('system_audit_logs')
      .select('hash')
      .eq('organizationId', organizationId)
      .eq('seq', seq)
      .maybeSingle();
    if (anchorError) {
      logger.error({ error: anchorError }, '監査ログの控えとの突き合わせに失敗しました');
      return badRequest('控えとの突き合わせに失敗しました', 500);
    }
    const stored = typeof row?.hash === 'string' ? row.hash : null;
    anchor = { seq, found: stored != null, matches: stored != null && stored === hash };
  }

  const passed = result.ok && (anchor == null || anchor.matches);
  await recordAudit(admin, check.profile, 'audit_log.verify', 'system_audit_logs', null, { ...result, anchor }, passed ? 'success' : 'failure');

  const body: VerifyResponse = { result, anchor };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
};
