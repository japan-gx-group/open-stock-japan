// 株主ポータル: 公開中のお知らせ 1 件と添付（GET）。下書き・他組織・存在しないものは 404（区別しない）。

import { getPortalUpdate } from '@/features/portal/services/portal.server';
import { portalJson } from '@/features/portal/services/respond.server';

export const runtime = 'nodejs';

export const GET = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  return portalJson((viewer) => getPortalUpdate(viewer, id));
};
