// 読取りの結果を破棄する（POST）。管理者・メンバーだけ。台帳には何も書かない（文書はライブラリに残る）。

import { requireEditor } from '@/lib/authz';
import { denied } from '@/lib/api/respond';
import { fromImportResult } from '@/lib/import/respond';
import { discardExtraction } from '@/lib/import/server';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export const POST = async (_request: Request, context: Context) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  return fromImportResult(await discardExtraction(check.profile, (await context.params).id));
};
