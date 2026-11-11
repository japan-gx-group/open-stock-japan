// 会社情報（GET は社内の全員、PATCH は管理者だけ）。項目は src/lib/resources/company.ts。

import { NextResponse } from 'next/server';
import { requireAdmin, requireInternal } from '@/lib/authz';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { COMPANY_COLUMNS, COMPANY_DEF } from '@/lib/resources/company';
import { normalizeRow, parseResourceInput } from '@/lib/resources/fields';
import { recordAudit } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

// fiscalYearStartMonth は select（文字列）で受けて smallint で保存する
const toRow = (data: unknown) => {
  const row = normalizeRow(COMPANY_DEF, data as Record<string, unknown>);
  if (row.fiscalYearStartMonth != null) row.fiscalYearStartMonth = String(row.fiscalYearStartMonth);
  return row;
};

export const GET = async () => {
  const check = await requireInternal();
  if (!check.ok) return denied(check);
  const { data, error } = await createAdminClient()
    .from('organizations')
    .select(COMPANY_COLUMNS)
    .eq('id', check.profile.organizationId)
    .single();
  if (error || !data) return badRequest('会社情報の取得に失敗しました', 500);
  return NextResponse.json({ company: toRow(data) });
};

export const PATCH = async (request: Request) => {
  const check = await requireAdmin();
  if (!check.ok) return denied(check);
  const parsed = parseResourceInput(COMPANY_DEF, await readJson(request), 'update');
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, fieldErrors: parsed.fieldErrors }, { status: 400 });

  const values: Record<string, unknown> = { ...parsed.values };
  values.fiscalYearStartMonth = values.fiscalYearStartMonth == null ? null : Number(values.fiscalYearStartMonth);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('organizations')
    .update(values)
    .eq('id', check.profile.organizationId)
    .select(COMPANY_COLUMNS)
    .single();
  if (error || !data) return badRequest('会社情報の保存に失敗しました', 500);
  await recordAudit(admin, check.profile, 'company.update', 'organizations', check.profile.organizationId, {
    changed: Object.keys(parsed.values),
  });
  return NextResponse.json({ company: toRow(data) });
};
