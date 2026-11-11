// 反映で作った行を見られる画面（純関数）。

import type { AppliedItem } from '@/lib/import/types';

const RESOURCE_PATHS: Record<string, { path: string; label: string }> = {
  stakeholders: { path: '/shareholders', label: '株主名簿' },
  'share-transactions': { path: '/shareholders', label: '株主名簿' },
  'share-classes': { path: '/rounds', label: '資金調達・種類株式' },
  'funding-rounds': { path: '/rounds', label: '資金調達・種類株式' },
  'convertible-rounds': { path: '/convertibles', label: 'J-KISS・転換型' },
  'convertible-investments': { path: '/convertibles', label: 'J-KISS・転換型' },
  'option-plans': { path: '/stock-options', label: 'ストックオプション' },
  'option-grants': { path: '/stock-options', label: 'ストックオプション' },
  officers: { path: '/company', label: '会社情報・役員' },
  'financial-reports': { path: '/financials', label: '決算情報' },
  meetings: { path: '/shareholder-meetings', label: '株主総会' },
  'meeting-agenda-items': { path: '/shareholder-meetings', label: '株主総会' },
};

export const COMPANY_LINK = { path: '/company', label: '会社情報・役員' };

/** リソースごとの一覧の画面。会議は、反映のときに決めたリンク先（取締役会か株主総会か）を優先する */
export const appliedLinkOf = (resource: string, items: AppliedItem[]): { path: string; label: string } | null => {
  const href = items.find((item) => item.href)?.href;
  if (href) return { path: href, label: href.startsWith('/board-meetings') ? '取締役会' : '株主総会' };
  return RESOURCE_PATHS[resource] ?? null;
};
