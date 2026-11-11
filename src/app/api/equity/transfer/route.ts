// 株式譲渡の記録（POST）。譲渡人の減少と譲受人の増加の 2 行を、同じ groupId でまとめて作る。
// 譲渡制限株式の譲渡には会社の承認が要る（会社法136条〜139条）。承認の記録（決議日など）はメモに残す。

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireEditor } from '@/lib/authz';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { buildRegistry } from '@/lib/equity/ledger';
import { fetchEquitySnapshot } from '@/lib/equity/server';
import { parseFieldValue, type FieldDef } from '@/lib/resources/fields';
import { recordAudit } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const FIELDS: FieldDef[] = [
  { key: 'fromStakeholderId', label: '譲渡人', type: 'ref', required: true },
  { key: 'toStakeholderId', label: '譲受人', type: 'ref', required: true },
  { key: 'shareClassId', label: '株式の種類', type: 'ref', required: true },
  { key: 'transactionDate', label: '譲渡日', type: 'date', required: true },
  { key: 'shares', label: '株式数', type: 'integer', required: true, min: 1, max: 1_000_000_000_000 },
  { key: 'pricePerShare', label: '1 株あたりの譲渡価格', type: 'decimal', min: 0 },
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
  if (!fieldErrors.toStakeholderId && values.fromStakeholderId === values.toStakeholderId) {
    fieldErrors.toStakeholderId = '譲渡人と譲受人には別の人を選んでください';
  }
  const firstError = Object.values(fieldErrors)[0];
  if (firstError) return NextResponse.json({ error: firstError, fieldErrors }, { status: 400 });

  const { organizationId } = check.profile;
  const admin = createAdminClient();
  const snapshot = await fetchEquitySnapshot(organizationId, admin);
  const from = snapshot.stakeholders.find((item) => item.id === values.fromStakeholderId);
  const to = snapshot.stakeholders.find((item) => item.id === values.toStakeholderId);
  const shareClass = snapshot.shareClasses.find((item) => item.id === values.shareClassId);
  if (!from || !to || !shareClass) return badRequest('株主または株式の種類が見つかりません。選び直してください');

  // 譲渡日時点で譲渡人が持っている株式数を超える譲渡は記録しない
  const shares = values.shares as number;
  const date = values.transactionDate as string;
  const held =
    buildRegistry(snapshot, date).rows.find((row) => row.stakeholderId === from.id && row.shareClassId === shareClass.id)?.shares ?? 0;
  if (shares > held) {
    return NextResponse.json(
      {
        error: `${from.name} が ${date} 時点で持っている ${shareClass.name} は ${held.toLocaleString('ja-JP')}株です`,
        fieldErrors: { shares: `譲渡できるのは ${held.toLocaleString('ja-JP')}株までです` },
      },
      { status: 400 },
    );
  }

  const price = values.pricePerShare as number | null;
  const groupId = randomUUID();
  const common = {
    organizationId,
    shareClassId: shareClass.id,
    groupId,
    transactionDate: date,
    transactionType: 'transfer',
    pricePerShare: price,
    amount: price != null ? Math.round(price * shares) : null,
    notes: (values.notes as string) ?? '',
  };
  const { data, error } = await admin
    .from('share_transactions')
    .insert([
      { ...common, stakeholderId: from.id, shares: -shares, counterparty: to.name },
      { ...common, stakeholderId: to.id, shares, counterparty: from.name },
    ])
    .select('id');
  if (error || !data) return badRequest('株式譲渡の記録に失敗しました', 500);

  await recordAudit(admin, check.profile, 'share-transactions.transfer', 'share_transactions', null, {
    groupId,
    from: from.name,
    to: to.name,
    shareClass: shareClass.name,
    shares,
  });
  return NextResponse.json({ groupId }, { status: 201 });
};
