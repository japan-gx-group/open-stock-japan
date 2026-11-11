import { redirect } from 'next/navigation';
import { FinancialReportCard } from '@/features/portal/components/FinancialReportCard';
import { HoldingsSummary, HoldingsUnlinked } from '@/features/portal/components/HoldingsView';
import { Empty, MoreLink, PortalTitle, Section, UpdateList } from '@/features/portal/components/parts';
import { getPortalHome } from '@/features/portal/services/portal.server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { isInternal } from '@/types/role';

// 株主ポータルのホーム: 最新のお知らせ・最新の決算情報・自分の保有状況の要約。
export default async function PortalHomePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const home = await getPortalHome(profile);

  return (
    <>
      <PortalTitle
        title={home.holdings.holderName ? `${home.holdings.holderName} 様` : '株主ポータル'}
        description="会社からのお知らせ・決算情報・文書と、ご自身の保有状況を確認できます。"
      />
      <div className="flex flex-col gap-4">
        <Section title="お知らせ" action={<MoreLink href="/external-portal/updates">すべて見る</MoreLink>}>
          {home.updates.length === 0 ? <Empty>公開されているお知らせはまだありません。</Empty> : <UpdateList updates={home.updates} />}
        </Section>
        <Section title="最新の決算情報" action={<MoreLink href="/external-portal/financials">決算情報へ</MoreLink>}>
          {home.latestReport ? (
            <FinancialReportCard report={home.latestReport} all={[home.latestReport]} compact />
          ) : (
            <Empty>公開されている決算情報はまだありません。</Empty>
          )}
        </Section>
        <Section title="あなたの保有状況" action={home.holdings.linked ? <MoreLink href="/external-portal/holdings">詳しく見る</MoreLink> : undefined}>
          {home.holdings.linked ? <HoldingsSummary holdings={home.holdings} /> : <HoldingsUnlinked isPreview={isInternal(profile.role)} />}
        </Section>
      </div>
    </>
  );
}
