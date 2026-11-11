// 手続きカレンダーの「完了」の記録（GET: 一覧 / PUT: 記録・取り消し）。
// 台帳に対応する日付の項目が無い手続き（申告・公告・調書の提出など）を、人が完了にするために使う。
// 読むのは社内の全員、記録できるのは管理者・メンバー。
// PUT の本文: { taskKey, completedOn: 'YYYY-MM-DD' | null（取り消し）, note? }

import { NextResponse } from 'next/server';
import { requireEditor, requireInternal } from '@/lib/authz';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { isValidDateText, todayInTokyo } from '@/lib/equity/format';
import type { TaskCompletions } from '@/lib/legal/calendar';
import { recordAudit } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

// calendar.ts が作るキーの形（種類:識別子）。識別子は uuid か年月
const TASK_KEY_PATTERN = /^[a-z][a-z-]{1,40}(:[0-9A-Za-z-]{1,80})?$/;

export const GET = async () => {
  const check = await requireInternal();
  if (!check.ok) return denied(check);
  const { data, error } = await createAdminClient()
    .from('compliance_task_states')
    .select('taskKey, completedOn, note')
    .eq('organizationId', check.profile.organizationId);
  if (error) return badRequest('完了の記録の取得に失敗しました', 500);
  const completions: TaskCompletions = {};
  for (const row of (data ?? []) as { taskKey: string; completedOn: string; note: string }[]) {
    completions[row.taskKey] = { completedOn: row.completedOn, note: row.note };
  }
  return NextResponse.json({ completions });
};

export const PUT = async (request: Request) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  const body = (await readJson(request)) as { taskKey?: unknown; completedOn?: unknown; note?: unknown } | null;
  const taskKey = typeof body?.taskKey === 'string' ? body.taskKey : '';
  if (!TASK_KEY_PATTERN.test(taskKey)) return badRequest('手続きの指定が正しくありません');
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (note.length > 500) return badRequest('メモは 500 文字以内で入力してください');

  const admin = createAdminClient();
  const { organizationId } = check.profile;

  if (body?.completedOn == null || body.completedOn === '') {
    const { error } = await admin
      .from('compliance_task_states')
      .delete()
      .eq('organizationId', organizationId)
      .eq('taskKey', taskKey);
    if (error) return badRequest('完了の取り消しに失敗しました', 500);
    await recordAudit(admin, check.profile, 'compliance.reopen', 'compliance_task_states', null, { taskKey });
    return NextResponse.json({ completion: null });
  }

  const completedOn = typeof body.completedOn === 'string' ? body.completedOn : '';
  if (!isValidDateText(completedOn)) return badRequest('完了した日を正しい日付で入力してください');
  if (completedOn > todayInTokyo()) return badRequest('完了した日に未来の日付は指定できません');

  const { error } = await admin
    .from('compliance_task_states')
    .upsert({ organizationId, taskKey, completedOn, note, updatedByUserId: check.profile.id }, { onConflict: 'organizationId,taskKey' });
  if (error) return badRequest('完了の記録に失敗しました', 500);
  await recordAudit(admin, check.profile, 'compliance.complete', 'compliance_task_states', null, { taskKey, completedOn });
  return NextResponse.json({ completion: { completedOn, note } });
};
