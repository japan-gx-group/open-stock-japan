// 株主ポータルのデータ取得（サーバ専用）。ポータルの画面（Server Component）と /api/external-portal/** がここを通る。
//
// 守ること:
//   - 入口で getCurrentProfile() の結果（PortalViewer）を受け取り、すべて viewer.organizationId で絞る。
//   - service_role で読んだ行は、必ず ./visibility.ts の関数（株主に見せてよいものだけを残す・写す）を通してから返す。
//   - 保有状況は viewer.stakeholderId の分だけ。台帳一式（スナップショット）そのものは返さない。
//   - 社内の人（プレビュー）には、株主と同じ公開済みの内容と、空の保有状況を返す。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CurrentProfile } from '@/lib/currentProfile';
import { DOCUMENT_COLUMNS } from '@/lib/documents/server';
import { todayInTokyo } from '@/lib/equity/format';
import { fetchEquitySnapshot } from '@/lib/equity/server';
import { isUuid } from '@/lib/resources/fields';
import { listResource } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isShareholder } from '@/types/role';
import {
  buildOwnHoldings,
  emptyHoldings,
  publishedReports,
  publishedUpdates,
  toUpdateSummary,
  visibleDocuments,
  withoutUnpublishedParents,
  type PortalDocument,
  type PortalFinancialReport,
  type PortalHoldings,
  type PortalUpdate,
  type PortalUpdateSummary,
} from './visibility';

export type PortalViewer = Pick<CurrentProfile, 'id' | 'organizationId' | 'role' | 'stakeholderId'>;

/** 保有状況を引くときの権利者。株主ロールのアカウントだけが自分の権利者に紐づく（社内の人は常に null） */
const holderIdOf = (viewer: PortalViewer): string | null => (isShareholder(viewer.role) ? viewer.stakeholderId : null);

export const getPortalCompanyName = async (viewer: PortalViewer, admin: SupabaseClient = createAdminClient()): Promise<string> => {
  const { data } = await admin.from('organizations').select('name').eq('id', viewer.organizationId).maybeSingle();
  return typeof data?.name === 'string' ? data.name : '';
};

const loadUpdates = async (viewer: PortalViewer, admin: SupabaseClient): Promise<PortalUpdate[]> =>
  publishedUpdates(await listResource('shareholder-updates', viewer.organizationId, {}, admin));

const loadReports = async (viewer: PortalViewer, admin: SupabaseClient): Promise<PortalFinancialReport[]> =>
  publishedReports(await listResource('financial-reports', viewer.organizationId, {}, admin));

/** この人が読める文書（全株主あて ＋ 自分あて）。公開されていないお知らせ・決算に付いたものは除く */
const loadDocuments = async (
  viewer: PortalViewer,
  admin: SupabaseClient,
  published: { updateIds: ReadonlySet<string>; reportIds: ReadonlySet<string> },
): Promise<PortalDocument[]> => {
  const holderId = holderIdOf(viewer);
  const sharedIds = new Set<string>();
  if (holderId) {
    const { data, error } = await admin
      .from('document_shares')
      .select('documentId')
      .eq('organizationId', viewer.organizationId)
      .eq('stakeholderId', holderId);
    if (error) throw new Error('文書の取得に失敗しました');
    for (const row of (data ?? []) as { documentId: string }[]) sharedIds.add(row.documentId);
  }
  // 社内のみの文書は DB の段階で除く（そのうえで visibleDocuments でもう一度確かめる）
  const { data, error } = await admin
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('organizationId', viewer.organizationId)
    .in('visibility', ['shareholders', 'restricted'])
    .order('createdAt', { ascending: false })
    .limit(2000);
  if (error) throw new Error('文書の取得に失敗しました');
  const visible = visibleDocuments((data ?? []) as unknown as Record<string, unknown>[], sharedIds);
  return withoutUnpublishedParents(visible, published.updateIds, published.reportIds);
};

const idsOf = (rows: readonly { id: string }[]): Set<string> => new Set(rows.map((row) => row.id));

export const getPortalUpdates = async (viewer: PortalViewer, admin: SupabaseClient = createAdminClient()): Promise<PortalUpdateSummary[]> =>
  (await loadUpdates(viewer, admin)).map(toUpdateSummary);

/** 公開中のお知らせ 1 件と、その添付（株主が読めるものだけ）。下書き・他組織・存在しないは null（区別しない） */
export const getPortalUpdate = async (
  viewer: PortalViewer,
  id: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<{ update: PortalUpdate; attachments: PortalDocument[] } | null> => {
  if (!isUuid(id)) return null;
  const [updates, reports] = await Promise.all([loadUpdates(viewer, admin), loadReports(viewer, admin)]);
  const update = updates.find((row) => row.id === id);
  if (!update) return null;
  const documents = await loadDocuments(viewer, admin, { updateIds: idsOf(updates), reportIds: idsOf(reports) });
  return {
    update,
    attachments: documents.filter((document) => document.entityType === 'shareholder_update' && document.entityId === id),
  };
};

export interface PortalFinancials {
  reports: PortalFinancialReport[];
  /** 決算情報に付いた文書（決算情報の id ごと） */
  documentsByReportId: Record<string, PortalDocument[]>;
}

export const getPortalFinancials = async (viewer: PortalViewer, admin: SupabaseClient = createAdminClient()): Promise<PortalFinancials> => {
  const [updates, reports] = await Promise.all([loadUpdates(viewer, admin), loadReports(viewer, admin)]);
  const documents = await loadDocuments(viewer, admin, { updateIds: idsOf(updates), reportIds: idsOf(reports) });
  const documentsByReportId: Record<string, PortalDocument[]> = {};
  for (const document of documents) {
    if (document.entityType !== 'financial_report' || !document.entityId) continue;
    (documentsByReportId[document.entityId] ??= []).push(document);
  }
  return { reports, documentsByReportId };
};

export const getPortalDocuments = async (viewer: PortalViewer, admin: SupabaseClient = createAdminClient()): Promise<PortalDocument[]> => {
  const [updates, reports] = await Promise.all([loadUpdates(viewer, admin), loadReports(viewer, admin)]);
  return loadDocuments(viewer, admin, { updateIds: idsOf(updates), reportIds: idsOf(reports) });
};

/** 自分の保有状況。社内の人（プレビュー）と、権利者に紐づいていないアカウントは空 */
export const getPortalHoldings = async (viewer: PortalViewer, admin: SupabaseClient = createAdminClient()): Promise<PortalHoldings> => {
  const asOf = todayInTokyo();
  const holderId = holderIdOf(viewer);
  if (!holderId) return emptyHoldings(asOf);
  // 台帳一式はこの関数の中だけで使い、自分の行と発行済株式総数だけを取り出して返す
  return buildOwnHoldings(await fetchEquitySnapshot(viewer.organizationId, admin), holderId, asOf);
};

export interface PortalHome {
  updates: PortalUpdateSummary[];
  latestReport: PortalFinancialReport | null;
  holdings: PortalHoldings;
}

export const getPortalHome = async (viewer: PortalViewer, admin: SupabaseClient = createAdminClient()): Promise<PortalHome> => {
  const [updates, reports, holdings] = await Promise.all([
    loadUpdates(viewer, admin),
    loadReports(viewer, admin),
    getPortalHoldings(viewer, admin),
  ]);
  return { updates: updates.slice(0, 5).map(toUpdateSummary), latestReport: reports[0] ?? null, holdings };
};
