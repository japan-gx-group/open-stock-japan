// 確認した内容を台帳に反映する（POST）。管理者・メンバーだけ（会社情報の変更を含む反映は管理者だけ）。
// 本文は { rows: { まとまり: [{ key, include, values, refs, ticked? }] } }。サーバは今の台帳で検証し直してから書き込む。

import { requireEditor } from '@/lib/authz';
import { denied, readJson } from '@/lib/api/respond';
import { fromImportResult } from '@/lib/import/respond';
import { applyExtraction } from '@/lib/import/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

export const POST = async (request: Request, context: Context) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  return fromImportResult(await applyExtraction(check.profile, (await context.params).id, await readJson(request)));
};
