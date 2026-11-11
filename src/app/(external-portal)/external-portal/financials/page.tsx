import { redirect } from 'next/navigation';
import { FinancialCharts } from '@/features/financials/components/FinancialCharts.client';
import { annualSeries } from '@/features/financials/services/analysis';
import { FinancialReportCard } from '@/features/portal/components/FinancialReportCard';
import { Empty, PortalTitle } from '@/features/portal/components/parts';
import { getPortalFinancials } from '@/features/portal/services/portal.server';
import { getCurrentProfile } from '@/lib/currentProfile';

// 株主ポータル: 株主に公開された決算情報。
export default async function PortalFinancialsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const { reports, documentsByReportId } = await getPortalFinancials(profile);
  const series = annualSeries(reports);
  return (
    <>
      <PortalTitle title="決算情報" description="会社が株主のみなさまに公開した決算の概要です。金額は円単位の数字を丸めて表示しています。" />
      {reports.length === 0 ? (
        <div className="gt-card">
          <Empty>公開されている決算情報はまだありません。</Empty>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {series.length >= 2 && <FinancialCharts points={series} />}
          {reports.map((report) => (
            <section key={report.id} className="gt-card">
              <FinancialReportCard report={report} all={reports} documents={documentsByReportId[report.id] ?? []} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
