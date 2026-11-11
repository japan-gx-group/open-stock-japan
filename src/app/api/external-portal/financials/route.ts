// 株主ポータル: 株主に公開した決算情報と、その添付（GET）。

import { getPortalFinancials } from '@/features/portal/services/portal.server';
import { portalJson } from '@/features/portal/services/respond.server';

export const runtime = 'nodejs';

export const GET = () => portalJson((viewer) => getPortalFinancials(viewer));
