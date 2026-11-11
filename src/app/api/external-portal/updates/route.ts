// 株主ポータル: 公開中のお知らせの一覧（GET）。ログイン中の本人の組織の分だけ。

import { getPortalUpdates } from '@/features/portal/services/portal.server';
import { portalJson } from '@/features/portal/services/respond.server';

export const runtime = 'nodejs';

export const GET = () => portalJson(async (viewer) => ({ items: await getPortalUpdates(viewer) }));
