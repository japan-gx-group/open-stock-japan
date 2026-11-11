// 株式分割・併合の記録（POST）。対象の種類を持つ全株主に、増減の行を同じ groupId でまとめて作る。
// 分割は取締役会決議（取締役会を置かない会社は株主総会の普通決議。会社法183条）、併合は株主総会の特別決議（180条）。
// 新株予約権の目的となる株式数・行使価額の調整は発行要項によるため、ここでは変えない（画面で案内する）。

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireEditor } from '@/lib/authz';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { splitAdjustments } from '@/lib/equity/ledger';
import { fetchEquitySnapshot } from '@/lib/equity/server';
import { parseFieldValue, type FieldDef } from '@/lib/resources/fields';
import { recordAudit } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const FIELDS: FieldDef[] = [
  { key: 'shareClassId', label: '株式の種類', type: 'ref', required: true },
  { key: 'transactionDate', label: '効力発生日', type: 'date', required: true },
  { key: 'ratio', label: '分割の割合', type: 'decimal', required: true, min: 0.000001, max: 1_000_000, nonZero: true },
  { key: 'notes', label: 'メモ', type: 'textarea', maxLength: 4000 },
];

export const POST = async (request: Request) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);
  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return badRequest('入力内容が不正です');

  const values: Record<string, string | number | boolean | null> = {};
  const fieldErrors: Record<string, string> = {};
  for (const field of FIELDS) {
    const parsed = parseFieldValue(field, body[field.key]);
    if (parsed.ok) values[field.key] = parsed.value;
    else fieldErrors[field.key] = parsed.error;
  }
  if (values.ratio === 1) fieldErrors.ratio = '1 株を 1 株にする分割は記録できません';
  const firstError = Object.values(fieldErrors)[0];
  if (firstError) return NextResponse.json({ error: firstError, fieldErrors }, { status: 400 });

  const { organizationId } = check.profile;
  const admin = createAdminClient();
  const snapshot = await fetchEquitySnapshot(organizationId, admin);
  const shareClass = snapshot.shareClasses.find((item) => item.id === values.shareClassId);
  if (!shareClass) return badRequest('株式の種類が見つかりません。選び直してください');

  const date = values.transactionDate as string;
  const ratio = values.ratio as number;
  if (snapshot.shareTransactions.some((item) => item.shareClassId === shareClass.id && item.transactionDate > date)) {
    return badRequest('効力発生日より後の日付の異動が記録されています。分割・併合は、その種類の最後の異動より後の日付で記録してください');
  }
  const adjustments = splitAdjustments(snapshot, shareClass.id, ratio, date);
  if (adjustments.length === 0) return badRequest('この種類の株式を持つ株主がいないか、株式数が変わりません');

  const groupId = randomUUID();
  const { error } = await admin.from('share_transactions').insert(
    adjustments.map((row) => ({
      organizationId,
      stakeholderId: row.stakeholderId,
      shareClassId: shareClass.id,
      groupId,
      transactionDate: date,
      transactionType: 'split',
      shares: row.delta,
      notes: (values.notes as string) || `1 株 → ${ratio} 株（${row.before.toLocaleString('ja-JP')}株 → ${row.after.toLocaleString('ja-JP')}株）`,
    })),
  );
  if (error) return badRequest('株式分割の記録に失敗しました', 500);

  await recordAudit(admin, check.profile, 'share-transactions.split', 'share_transactions', null, {
    groupId,
    shareClass: shareClass.name,
    ratio,
    holders: adjustments.length,
  });
  return NextResponse.json({ groupId, adjustments }, { status: 201 });
};
