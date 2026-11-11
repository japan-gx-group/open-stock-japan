import { ShareholdersPage as ShareholdersScreen } from '@/features/shareholders/components/ShareholdersPage.client';
import { isShareholdersTab } from '@/features/shareholders/types';

// 株主名簿（株主名簿・権利者・株式の異動）。?tab=stakeholders / ?tab=transactions で開くタブを指定できる。
export default async function ShareholdersPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  const requested = Array.isArray(tab) ? tab[0] : tab;
  return <ShareholdersScreen initialTab={isShareholdersTab(requested) ? requested : undefined} />;
}
