// 株主ポータルで「株主に見せてよいもの」を決める関数。サーバ依存なし（単体テストで守る）。
//
// ここを通ったものだけがポータルの画面・API に出る。考え方:
//   - お知らせ: 公開中（status = 'published'）だけ。
//   - 決算情報: 「株主ポータルに公開する」にしたものだけ。株主向けの項目だけを写す（社内用の列は落とす）。
//   - 文書: 公開範囲が「全株主」、または「指定した株主」で自分が指定されているもの。社内のみは出さない。
//   - 保有状況: 自分（stakeholderId）の行だけ。ほかの株主の氏名・住所・メール・持株は一切含めない。
//     割合の計算に要る全社の合計（発行済株式総数）だけを添える。

import { grantEventTotals, grantRemainingUnits } from '@/lib/equity/capTable';
import { buildRegistry } from '@/lib/equity/ledger';
import type { EquitySnapshot } from '@/lib/equity/types';
import { exercisableUnits, exercisePeriodState, vestingStatus, type ExercisePeriodState } from '@/lib/equity/vesting';

// ---- お知らせ ----

export interface PortalUpdateSummary {
  id: string;
  title: string;
  category: string;
  publishedAt: string | null;
}

export interface PortalUpdate extends PortalUpdateSummary {
  body: string;
}

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const isPublishedUpdate = (row: Row): boolean => row.status === 'published';

export const toPortalUpdate = (row: Row): PortalUpdate => ({
  id: text(row.id),
  title: text(row.title),
  category: text(row.category),
  publishedAt: textOrNull(row.publishedAt),
  body: text(row.body),
});

/** 公開中のお知らせだけを、公開日の新しい順に並べる */
export const publishedUpdates = (rows: readonly Row[]): PortalUpdate[] =>
  rows
    .filter(isPublishedUpdate)
    .map(toPortalUpdate)
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

export const toUpdateSummary = ({ id, title, category, publishedAt }: PortalUpdate): PortalUpdateSummary => ({
  id,
  title,
  category,
  publishedAt,
});

// ---- 決算情報 ----

export interface PortalFinancialReport {
  id: string;
  title: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  ordinaryIncome: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  netAssets: number | null;
  cashAndDeposits: number | null;
  interestBearingDebt: number | null;
  employees: number | null;
  highlights: string;
  /** 定時株主総会などで承認済みか（作成中の数字は速報として示す） */
  isApproved: boolean;
  publishedAt: string | null;
}

export const isPublishedReport = (row: Row): boolean => row.isPublishedToShareholders === true;

export const toPortalFinancialReport = (row: Row): PortalFinancialReport => ({
  id: text(row.id),
  title: text(row.title),
  periodType: text(row.periodType),
  periodStart: text(row.periodStart),
  periodEnd: text(row.periodEnd),
  revenue: numberOrNull(row.revenue),
  grossProfit: numberOrNull(row.grossProfit),
  operatingIncome: numberOrNull(row.operatingIncome),
  ordinaryIncome: numberOrNull(row.ordinaryIncome),
  netIncome: numberOrNull(row.netIncome),
  totalAssets: numberOrNull(row.totalAssets),
  netAssets: numberOrNull(row.netAssets),
  cashAndDeposits: numberOrNull(row.cashAndDeposits),
  interestBearingDebt: numberOrNull(row.interestBearingDebt),
  employees: numberOrNull(row.employees),
  highlights: text(row.highlights),
  isApproved: row.status === 'approved',
  publishedAt: textOrNull(row.publishedAt),
});

/** 株主に公開した決算情報だけを、期間の新しい順に並べる */
export const publishedReports = (rows: readonly Row[]): PortalFinancialReport[] =>
  rows
    .filter(isPublishedReport)
    .map(toPortalFinancialReport)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

// ---- 文書 ----

export interface PortalDocument {
  id: string;
  title: string;
  category: string;
  description: string;
  documentDate: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** 関連するお知らせ・決算情報（画面のリンクに使う）。それ以外の種類は null */
  entityType: 'shareholder_update' | 'financial_report' | null;
  entityId: string | null;
  createdAt: string;
}

/**
 * 株主が読める文書か（src/lib/documents/server.ts の canReadDocument の株主側と同じ規則）。
 * sharedDocumentIds は、この株主あての document_shares にある文書の id。
 * 社内の人がプレビューで開いたときは stakeholderId が無いので、「全株主」の文書だけになる。
 */
export const isDocumentVisibleToShareholder = (
  document: { id: unknown; visibility: unknown },
  sharedDocumentIds: ReadonlySet<string>,
): boolean =>
  document.visibility === 'shareholders' ||
  (document.visibility === 'restricted' && typeof document.id === 'string' && sharedDocumentIds.has(document.id));

export const toPortalDocument = (row: Row): PortalDocument => {
  const entityType = row.entityType === 'shareholder_update' || row.entityType === 'financial_report' ? row.entityType : null;
  return {
    id: text(row.id),
    title: text(row.title),
    category: text(row.category),
    description: text(row.description),
    documentDate: textOrNull(row.documentDate),
    fileName: text(row.fileName),
    mimeType: text(row.mimeType),
    sizeBytes: numberOrNull(row.sizeBytes) ?? 0,
    entityType,
    entityId: entityType ? textOrNull(row.entityId) : null,
    createdAt: text(row.createdAt),
  };
};

export const visibleDocuments = (rows: readonly Row[], sharedDocumentIds: ReadonlySet<string>): PortalDocument[] =>
  rows
    .filter((row) => isDocumentVisibleToShareholder({ id: row.id, visibility: row.visibility }, sharedDocumentIds))
    .map(toPortalDocument);

/**
 * お知らせ・決算情報に付いた文書のうち、公開されている親に付いたものだけを残す
 * （下書きのお知らせの添付は、公開範囲が「全株主」でも一覧に出さない）。
 */
export const withoutUnpublishedParents = (
  documents: readonly PortalDocument[],
  publishedUpdateIds: ReadonlySet<string>,
  publishedReportIds: ReadonlySet<string>,
): PortalDocument[] =>
  documents.filter((document) => {
    if (document.entityType === 'shareholder_update') return document.entityId != null && publishedUpdateIds.has(document.entityId);
    if (document.entityType === 'financial_report') return document.entityId != null && publishedReportIds.has(document.entityId);
    return true;
  });

// ---- 自分の保有状況 ----

export interface PortalShareHolding {
  shareClassName: string;
  shares: number;
  firstAcquiredOn: string | null;
  lastAcquiredOn: string | null;
  /** 発行済株式総数に対する割合 */
  ratio: number;
}

export interface PortalOptionGrant {
  planName: string;
  planType: string;
  grantedOn: string | null;
  units: number;
  sharesPerUnit: number;
  vestedUnits: number;
  unvestedUnits: number;
  exercisedUnits: number;
  forfeitedUnits: number;
  remainingUnits: number;
  /** いま行使できる個数（確定済み − 行使済み − 失効）。行使期間の外では 0 */
  exercisableUnits: number;
  exercisePrice: number;
  exercisePeriodStart: string | null;
  exercisePeriodEnd: string | null;
  exercisePeriodState: ExercisePeriodState;
  fullyVestedOn: string | null;
  cliffOn: string | null;
  exerciseConditions: string;
}

export interface PortalConvertible {
  roundName: string;
  instrumentType: string;
  status: string;
  amount: number;
  investmentDate: string | null;
  valuationCap: number | null;
  discountRate: number;
  conversionDeadline: string | null;
  convertedShares: number | null;
  convertedOn: string | null;
}

export interface PortalHoldings {
  /** アカウントが権利者に紐づいているか（社内の人のプレビューでは false） */
  linked: boolean;
  /** 自分の氏名・名称（名簿上の表記） */
  holderName: string | null;
  asOf: string;
  /** 会社全体の発行済株式総数（割合の分母） */
  totalIssuedShares: number;
  ownShares: number;
  ownRatio: number;
  shares: PortalShareHolding[];
  optionGrants: PortalOptionGrant[];
  convertibles: PortalConvertible[];
}

export const emptyHoldings = (asOf: string, totalIssuedShares = 0): PortalHoldings => ({
  linked: false,
  holderName: null,
  asOf,
  totalIssuedShares,
  ownShares: 0,
  ownRatio: 0,
  shares: [],
  optionGrants: [],
  convertibles: [],
});

/**
 * 台帳一式から、1 人の権利者の保有状況だけを取り出す。
 * 戻り値には、ほかの権利者に由来する値は「発行済株式総数」しか含まれない。
 */
export const buildOwnHoldings = (snapshot: EquitySnapshot, stakeholderId: string | null, asOf: string): PortalHoldings => {
  const registry = buildRegistry(snapshot);
  if (!stakeholderId) return emptyHoldings(asOf, 0);
  const holder = snapshot.stakeholders.find((stakeholder) => stakeholder.id === stakeholderId);
  if (!holder) return emptyHoldings(asOf, 0);

  const shares: PortalShareHolding[] = registry.rows
    .filter((row) => row.stakeholderId === stakeholderId)
    .map((row) => ({
      shareClassName: row.shareClassName,
      shares: row.shares,
      firstAcquiredOn: row.firstAcquiredOn,
      lastAcquiredOn: row.lastAcquiredOn,
      ratio: row.totalRatio,
    }));
  const ownShares = shares.reduce((total, row) => total + row.shares, 0);

  const planById = new Map(snapshot.optionPlans.map((plan) => [plan.id, plan]));
  const eventTotals = grantEventTotals(snapshot.optionEvents);
  const optionGrants: PortalOptionGrant[] = [];
  for (const grant of snapshot.optionGrants) {
    if (grant.stakeholderId !== stakeholderId) continue;
    const plan = planById.get(grant.planId);
    if (!plan) continue;
    const vesting = vestingStatus(grant, plan, asOf);
    const used = eventTotals.get(grant.id) ?? { exercised: 0, forfeited: 0 };
    const periodState = exercisePeriodState(plan, asOf);
    optionGrants.push({
      planName: plan.name,
      planType: plan.planType,
      grantedOn: grant.grantedOn,
      units: grant.units,
      sharesPerUnit: plan.sharesPerUnit,
      vestedUnits: vesting.vestedUnits,
      unvestedUnits: vesting.unvestedUnits,
      exercisedUnits: used.exercised,
      forfeitedUnits: used.forfeited,
      remainingUnits: grantRemainingUnits(grant, eventTotals),
      exercisableUnits:
        periodState === 'before' || periodState === 'closed'
          ? 0
          : exercisableUnits(vesting.vestedUnits, used.exercised, used.forfeited, grant.units),
      exercisePrice: plan.exercisePrice,
      exercisePeriodStart: plan.exercisePeriodStart,
      exercisePeriodEnd: plan.exercisePeriodEnd,
      exercisePeriodState: periodState,
      fullyVestedOn: vesting.fullyVestedOn,
      cliffOn: vesting.cliffOn,
      exerciseConditions: plan.exerciseConditions,
    });
  }

  const roundById = new Map(snapshot.convertibleRounds.map((round) => [round.id, round]));
  const convertibles: PortalConvertible[] = [];
  for (const investment of snapshot.convertibleInvestments) {
    if (investment.stakeholderId !== stakeholderId) continue;
    const round = roundById.get(investment.roundId);
    if (!round) continue;
    convertibles.push({
      roundName: round.name,
      instrumentType: round.instrumentType,
      status: round.status,
      amount: investment.amount,
      investmentDate: investment.investmentDate,
      valuationCap: round.valuationCap,
      discountRate: round.discountRate,
      conversionDeadline: round.conversionDeadline,
      convertedShares: investment.convertedShares,
      convertedOn: investment.convertedOn,
    });
  }

  return {
    linked: true,
    holderName: holder.name,
    asOf,
    totalIssuedShares: registry.totalShares,
    ownShares,
    ownRatio: registry.totalShares > 0 ? ownShares / registry.totalShares : 0,
    shares,
    optionGrants,
    convertibles,
  };
};
