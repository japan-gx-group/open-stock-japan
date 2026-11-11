// 株主に公開した決算情報 1 件の表示（数字・前年の同じ期間との増減・ハイライト・添付）。
import { changeOf, findPreviousComparable, formatChange, formatCompactYen, formatPeriod } from '@/features/financials/services/analysis';
import { optionLabel } from '@/lib/equity/types';
import { FINANCIAL_PERIOD_TYPES } from '@/lib/resources/definitions';
import type { PortalDocument, PortalFinancialReport } from '../services/visibility';
import { DocumentList } from './parts';

const FIGURES = [
  ['revenue', '売上高'],
  ['grossProfit', '売上総利益'],
  ['operatingIncome', '営業利益'],
  ['ordinaryIncome', '経常利益'],
  ['netIncome', '当期純利益'],
  ['cashAndDeposits', '現金及び預金'],
  ['totalAssets', '総資産'],
  ['netAssets', '純資産'],
  ['interestBearingDebt', '有利子負債'],
] as const;

export const FinancialReportCard = ({
  report,
  all,
  documents = [],
  compact = false,
}: {
  report: PortalFinancialReport;
  /** 公開されている決算情報すべて（前年の同じ期間を探す） */
  all: readonly PortalFinancialReport[];
  documents?: PortalDocument[];
  /** ホーム用の短い表示（主要な数字だけ） */
  compact?: boolean;
}) => {
  const previous = findPreviousComparable(report, all);
  const figures = FIGURES.filter(([key]) => report[key] != null).slice(0, compact ? 5 : FIGURES.length);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-text-heading">{report.title}</span>
        <span className="gt-pill gt-pill-sm gt-pill-neutral">{optionLabel(FINANCIAL_PERIOD_TYPES, report.periodType)}</span>
        <span className={`gt-pill gt-pill-sm ${report.isApproved ? 'gt-pill-good' : 'gt-pill-warn'}`}>{report.isApproved ? '承認済み' : '速報（承認前）'}</span>
        <span className="text-[12px] text-text-muted whitespace-nowrap">{formatPeriod(report.periodStart, report.periodEnd)}</span>
      </div>
      {figures.length === 0 ? (
        <p className="text-[13px] text-text-muted mt-3 mb-0">数字は掲載されていません。</p>
      ) : (
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3 mb-0">
          {figures.map(([key, label]) => {
            const change = changeOf(report[key], previous ? previous[key] : null);
            return (
              <div key={key} className="rounded-md border border-border bg-bg-subtle px-3 py-2">
                <dt className="text-[11.5px] text-text-muted">{label}</dt>
                <dd className="m-0 text-[16px] font-semibold text-text-heading tabular-nums whitespace-nowrap">{formatCompactYen(report[key])}</dd>
                {/* 狭いタイルでは「前年同期比」のあとで折り返す（増減の数字は割らない） */}
                {change.diff != null && (
                  <dd className="m-0 text-[11.5px] text-text-muted tabular-nums">
                    前年同期比 <span className="whitespace-nowrap">{formatChange(change)}</span>
                  </dd>
                )}
              </div>
            );
          })}
          {!compact && report.employees != null && (
            <div className="rounded-md border border-border bg-bg-subtle px-3 py-2">
              <dt className="text-[11.5px] text-text-muted">従業員数</dt>
              <dd className="m-0 text-[16px] font-semibold text-text-heading tabular-nums whitespace-nowrap">{report.employees.toLocaleString('ja-JP')}人</dd>
            </div>
          )}
        </dl>
      )}
      {report.highlights && (
        <p className={`text-[13.5px] leading-[1.8] text-text-body mt-3 mb-0 whitespace-pre-wrap ${compact ? 'line-clamp-3' : ''}`}>{report.highlights}</p>
      )}
      {!compact && documents.length > 0 && (
        <div className="mt-3">
          <div className="text-[12px] font-medium text-text-muted">関連する文書</div>
          <DocumentList documents={documents} showCategory={false} />
        </div>
      )}
    </div>
  );
};
