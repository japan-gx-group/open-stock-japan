// 業務テーブルの読み書き（サーバ専用）。汎用 API（/api/resources/…）と AI 取り込みの反映がここを通る。
//
// 業務テーブルは authenticated に GRANT が無く、service_role でしか触れない。そのため必ず
//   1. 呼び出し側が requireInternal / requireEditor でロールを確かめ、
//   2. ここで organizationId（profile から取る。リクエストからは受け取らない）で絞り、
//   3. 参照（uuid）が自組織の行を指していることを確かめ、
//   4. 書き込みを system_audit_logs に残す
// の順で扱う。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CurrentProfile } from '@/lib/currentProfile';
import { logger } from '@/lib/logging/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { getResource, READ_ONLY_RESOURCES, RESOURCES, type ResourceName } from './definitions';
import { isUuid, normalizeRow, parseResourceInput, type ResourceDef, type ResourceRow, type ResourceValues } from './fields';

type Actor = Pick<CurrentProfile, 'id' | 'organizationId'>;

export type WriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string; fieldErrors?: Record<string, string> };

const columnsOf = (def: ResourceDef): string =>
  ['id', ...def.fields.map((field) => field.key), ...(def.readOnlyColumns ?? []), 'createdAt', 'updatedAt']
    // fiscal_years には updatedAt が無い
    .filter((column) => !(def.table === 'fiscal_years' && column === 'updatedAt'))
    .join(', ');

/** Postgres のエラーを利用者向けの文にする */
export const describeDbError = (error: { code?: string; message?: string } | null, def: ResourceDef): string => {
  switch (error?.code) {
    case '23503':
      return `この${def.label}は他の記録から参照されているため削除できません。先に関連する記録を削除してください`;
    case '23505':
      return `同じ内容の${def.label}がすでに登録されています`;
    case '23514':
      return '入力した値の組み合わせが正しくありません';
    case 'P3001':
      return '行使済みと失効の合計が割当個数を超えます';
    default:
      return `${def.label}の保存に失敗しました`;
  }
};

/** 監査ログに残す操作の結果。既定は成功 */
export type AuditOutcome = 'success' | 'failure' | 'denied';

/**
 * 操作の記録を監査ログに残す（データの行の変更そのものは、DB のトリガーが変更前後の値つきで別に残す）。
 * 接続元（IP アドレス・ブラウザ・リクエストの番号）と連番・ハッシュは DB が付けるので、ここでは渡さない。
 */
export const recordAudit = async (
  admin: SupabaseClient,
  actor: { id: string | null; organizationId: string },
  action: string,
  entityName: string,
  entityId: string | null,
  detail: Record<string, unknown>,
  outcome: AuditOutcome = 'success',
): Promise<void> => {
  // 本体の処理はすでに済んでいるので、記録の失敗では止めない。失敗はサーバのログに残して気づけるようにする
  const { error } = await admin.from('system_audit_logs').insert({
    organizationId: actor.organizationId,
    userId: actor.id,
    action,
    entityName,
    entityId,
    detail: JSON.stringify(detail),
    ...(outcome === 'success' ? {} : { outcome }),
  });
  if (error) {
    logger.error({ error, action, entityName }, '監査ログの記録に失敗しました');
  }
};

export const listResource = async (
  name: ResourceName,
  organizationId: string,
  filters: Record<string, string> = {},
  admin: SupabaseClient = createAdminClient(),
): Promise<ResourceRow[]> => {
  const def = getResource(name);
  let query = admin.from(def.table).select(columnsOf(def)).eq('organizationId', organizationId);
  for (const field of def.fields) {
    const value = filters[field.key];
    if (!field.filterable || value == null || value === '') continue;
    if (field.type === 'ref' && !isUuid(value)) return [];
    query = query.eq(field.key, value);
  }
  for (const order of def.orderBy) {
    query = query.order(order.column, { ascending: order.ascending, nullsFirst: false });
  }
  const { data, error } = await query.limit(5000);
  if (error) throw new Error(`${def.label}の取得に失敗しました`);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => normalizeRow(def, row));
};

export const getResourceRow = async (
  name: ResourceName,
  organizationId: string,
  id: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<ResourceRow | null> => {
  if (!isUuid(id)) return null;
  const def = getResource(name);
  const { data } = await admin
    .from(def.table)
    .select(columnsOf(def))
    .eq('organizationId', organizationId)
    .eq('id', id)
    .maybeSingle();
  return data ? normalizeRow(def, data as unknown as Record<string, unknown>) : null;
};

/** 参照先がすべて自組織の行であることを確かめる（FK は行の存在しか見ないため） */
const checkReferences = async (
  admin: SupabaseClient,
  def: ResourceDef,
  organizationId: string,
  values: ResourceValues,
): Promise<Record<string, string> | null> => {
  for (const field of def.fields) {
    if (field.type !== 'ref' || !field.ref) continue;
    const value = values[field.key];
    if (value == null) continue;
    const target = RESOURCES[field.ref as ResourceName];
    const { data } = await admin
      .from(target.table)
      .select('id')
      .eq('organizationId', organizationId)
      .eq('id', value as string)
      .maybeSingle();
    if (!data) return { [field.key]: `${field.label}が見つかりません。選び直してください` };
  }
  return null;
};

interface HookContext {
  admin: SupabaseClient;
  organizationId: string;
  mode: 'create' | 'update';
  existing: ResourceRow | null;
}

/** リソースごとの追加の検証と、サーバが決める列。問題があれば { 項目名: メッセージ } を返す */
const applyHooks = async (
  name: ResourceName,
  values: ResourceValues,
  context: HookContext,
): Promise<{ extra: Record<string, unknown>; fieldErrors: Record<string, string> | null }> => {
  const extra: Record<string, unknown> = {};

  if (name === 'share-transactions') {
    if (context.existing?.groupId) {
      return {
        extra,
        fieldErrors: { shares: '譲渡・分割としてまとめて記録した異動は編集できません。削除して入力し直してください' },
      };
    }
    const shares = values.shares as number;
    const price = values.pricePerShare as number | null;
    if (values.amount == null && price != null) values.amount = Math.round(price * Math.abs(shares));
    const amount = values.amount as number | null;
    const capital = values.capitalAmount as number | null;
    if (capital != null && amount != null && capital > amount) {
      return { extra, fieldErrors: { capitalAmount: '資本金に組み入れた額は金額（合計）以下にしてください' } };
    }
  }

  if (name === 'option-grants' && context.mode === 'update' && context.existing) {
    const { data } = await context.admin
      .from('option_events')
      .select('units')
      .eq('organizationId', context.organizationId)
      .eq('grantId', context.existing.id);
    const used = ((data ?? []) as { units: number }[]).reduce((total, row) => total + Number(row.units), 0);
    if ((values.units as number) < used) {
      return { extra, fieldErrors: { units: `割当個数は、行使済み・失効の合計（${used.toLocaleString('ja-JP')}個）以上にしてください` } };
    }
  }

  if (name === 'shareholder-updates') {
    const wasPublished = context.existing?.status === 'published';
    if (values.status === 'published' && !wasPublished) extra.publishedAt = new Date().toISOString();
    if (values.status !== 'published') extra.publishedAt = null;
  }

  // 「確認済み」は、いまの文面を人が確かめたという印。文面が変わったら、同じ保存で「確認済み」と送られていても
  // 「確認中」に戻す（確かめていない文面に、確認済みの印が残らないようにする）。
  if (name === 'document-templates' && context.existing?.status === 'reviewed' && values.body !== context.existing.body) {
    values.status = 'draft';
  }

  if (name === 'financial-reports') {
    const wasPublished = context.existing?.isPublishedToShareholders === true;
    if (values.isPublishedToShareholders === true && !wasPublished) extra.publishedAt = new Date().toISOString();
    if (values.isPublishedToShareholders !== true) extra.publishedAt = null;
  }

  return { extra, fieldErrors: null };
};

const changedKeys = (before: ResourceRow, after: ResourceValues): string[] =>
  Object.keys(after).filter((key) => (before[key] ?? null) !== (after[key] ?? null));

export const createResource = async (
  name: ResourceName,
  actor: Actor,
  body: unknown,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<ResourceRow>> => {
  const def = getResource(name);
  if (READ_ONLY_RESOURCES.includes(name)) return { ok: false, status: 400, error: `${def.label}はこの操作では登録できません` };
  const parsed = parseResourceInput(def, body, 'create');
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, fieldErrors: parsed.fieldErrors };

  const referenceErrors = await checkReferences(admin, def, actor.organizationId, parsed.values);
  if (referenceErrors) return { ok: false, status: 400, error: Object.values(referenceErrors)[0], fieldErrors: referenceErrors };

  const hooks = await applyHooks(name, parsed.values, { admin, organizationId: actor.organizationId, mode: 'create', existing: null });
  if (hooks.fieldErrors) return { ok: false, status: 400, error: Object.values(hooks.fieldErrors)[0], fieldErrors: hooks.fieldErrors };

  const { data, error } = await admin
    .from(def.table)
    .insert({ ...parsed.values, ...hooks.extra, organizationId: actor.organizationId })
    .select(columnsOf(def))
    .single();
  if (error || !data) return { ok: false, status: 400, error: describeDbError(error, def) };

  const row = normalizeRow(def, data as unknown as Record<string, unknown>);
  await recordAudit(admin, actor, `${name}.create`, def.table, row.id, { label: def.labelOf(row) });
  return { ok: true, data: row };
};

export const updateResource = async (
  name: ResourceName,
  actor: Actor,
  id: string,
  body: unknown,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<ResourceRow>> => {
  const def = getResource(name);
  if (READ_ONLY_RESOURCES.includes(name)) return { ok: false, status: 400, error: `${def.label}はこの操作では変更できません` };
  const existing = await getResourceRow(name, actor.organizationId, id, admin);
  if (!existing) return { ok: false, status: 404, error: `${def.label}が見つかりません` };

  const parsed = parseResourceInput(def, body, 'update');
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, fieldErrors: parsed.fieldErrors };

  const referenceErrors = await checkReferences(admin, def, actor.organizationId, parsed.values);
  if (referenceErrors) return { ok: false, status: 400, error: Object.values(referenceErrors)[0], fieldErrors: referenceErrors };

  const hooks = await applyHooks(name, parsed.values, { admin, organizationId: actor.organizationId, mode: 'update', existing });
  if (hooks.fieldErrors) return { ok: false, status: 400, error: Object.values(hooks.fieldErrors)[0], fieldErrors: hooks.fieldErrors };

  const { data, error } = await admin
    .from(def.table)
    .update({ ...parsed.values, ...hooks.extra })
    .eq('organizationId', actor.organizationId)
    .eq('id', id)
    .select(columnsOf(def))
    .single();
  if (error || !data) return { ok: false, status: 400, error: describeDbError(error, def) };

  const row = normalizeRow(def, data as unknown as Record<string, unknown>);
  await recordAudit(admin, actor, `${name}.update`, def.table, row.id, {
    label: def.labelOf(row),
    changed: changedKeys(existing, parsed.values),
  });
  return { ok: true, data: row };
};

export const deleteResource = async (
  name: ResourceName,
  actor: Actor,
  id: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<{ deletedIds: string[] }>> => {
  const def = getResource(name);
  if (READ_ONLY_RESOURCES.includes(name)) return { ok: false, status: 400, error: `${def.label}はこの操作では削除できません` };
  const existing = await getResourceRow(name, actor.organizationId, id, admin);
  if (!existing) return { ok: false, status: 404, error: `${def.label}が見つかりません` };

  // 譲渡・分割としてまとめて記録した異動は、片側だけ消すと発行済株式総数がずれるため、まとめて削除する
  const groupId = name === 'share-transactions' && typeof existing.groupId === 'string' ? existing.groupId : null;
  let query = admin.from(def.table).delete().eq('organizationId', actor.organizationId);
  query = groupId ? query.eq('groupId', groupId) : query.eq('id', id);
  const { data, error } = await query.select('id');
  if (error) return { ok: false, status: 409, error: describeDbError(error, def) };

  const deletedIds = ((data ?? []) as { id: string }[]).map((row) => row.id);
  await recordAudit(admin, actor, `${name}.delete`, def.table, id, { label: def.labelOf(existing), deleted: deletedIds.length });
  return { ok: true, data: { deletedIds } };
};
