// 株主ポータル: 本人が読める文書の一覧（GET）。全株主あての文書と、本人あてに公開された文書だけ。
// ダウンロードは /api/documents/<id>/download（権限を確かめて署名つき URL へリダイレクト）。

import { getPortalDocuments } from '@/features/portal/services/portal.server';
import { portalJson } from '@/features/portal/services/respond.server';

export const runtime = 'nodejs';

export const GET = () => portalJson(async (viewer) => ({ items: await getPortalDocuments(viewer) }));
