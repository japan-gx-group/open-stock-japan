// 株式・新株予約権の台帳一式をまとめて読む（サーバ専用）。呼び出し側がロールを確かめてから使う。
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { listResource } from '@/lib/resources/server';
import type { EquitySnapshot } from './types';

export const fetchEquitySnapshot = async (
  organizationId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<EquitySnapshot> => {
  const [
    stakeholders,
    shareClasses,
    fundingRounds,
    shareTransactions,
    convertibleRounds,
    convertibleInvestments,
    optionPlans,
    optionGrants,
    optionEvents,
  ] = await Promise.all([
    listResource('stakeholders', organizationId, {}, admin),
    listResource('share-classes', organizationId, {}, admin),
    listResource('funding-rounds', organizationId, {}, admin),
    listResource('share-transactions', organizationId, {}, admin),
    listResource('convertible-rounds', organizationId, {}, admin),
    listResource('convertible-investments', organizationId, {}, admin),
    listResource('option-plans', organizationId, {}, admin),
    listResource('option-grants', organizationId, {}, admin),
    listResource('option-events', organizationId, {}, admin),
  ]);
  // 行の形は定義（definitions.ts）と DB の列で決まり、types.ts の型と同じ列名になっている
  return {
    stakeholders,
    shareClasses,
    fundingRounds,
    shareTransactions,
    convertibleRounds,
    convertibleInvestments,
    optionPlans,
    optionGrants,
    optionEvents,
  } as unknown as EquitySnapshot;
};
