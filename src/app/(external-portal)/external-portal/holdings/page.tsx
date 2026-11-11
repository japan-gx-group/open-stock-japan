import { redirect } from 'next/navigation';
import { HoldingsDetail, HoldingsSummary, HoldingsUnlinked } from '@/features/portal/components/HoldingsView';
import { PortalTitle } from '@/features/portal/components/parts';
import { getPortalHoldings } from '@/features/portal/services/portal.server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { isInternal } from '@/types/role';

// 株主ポータル: 自分の保有状況（株式・新株予約権・転換型の投資）。ほかの株主の情報は出さない。
export default async function PortalHoldingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const holdings = await getPortalHoldings(profile);
  return (
    <>
      <PortalTitle
        title="あなたの保有状況"
        description="株主名簿などの会社の記録にもとづく、ご自身の分だけの表示です。内容に相違がある場合は会社にお問い合わせください。"
      />
      {holdings.linked ? (
        <div className="flex flex-col gap-4">
          <HoldingsSummary holdings={holdings} />
          <HoldingsDetail holdings={holdings} />
        </div>
      ) : (
        <div className="gt-card">
          <HoldingsUnlinked isPreview={isInternal(profile.role)} />
        </div>
      )}
    </>
  );
}
