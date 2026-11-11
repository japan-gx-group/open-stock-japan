// 株主ポータル: 本人の保有状況（GET）。株式・新株予約権・転換型の、本人の分と発行済株式総数だけを返す。
// 社内の人（プレビュー）には空の保有状況を返す。

import { getPortalHoldings } from '@/features/portal/services/portal.server';
import { portalJson } from '@/features/portal/services/respond.server';

export const runtime = 'nodejs';

export const GET = () => portalJson(async (viewer) => ({ holdings: await getPortalHoldings(viewer) }));
