// J-KISS・転換型の画面の集計。サーバ依存なし。
// 転換価額・転換株式数の計算は src/lib/equity/capTable.ts の buildCapTable（conversions）を使い、
// ここでは回次ごと・投資ごとに画面へ並べる形にまとめるだけにする。

import type { CapTable, ConversionDetail } from '@/lib/equity/capTable';
import { diffDays } from '@/lib/equity/format';
import type { ConvertibleInvestment, ConvertibleRound, EquitySnapshot, ShareTransaction } from '@/lib/equity/types';

/** 転換期限が近いとして目立たせる日数（画面の表示だけに使う目安。法令・契約の数値ではない） */
export const DEADLINE_SOON_DAYS = 90;

export type DeadlineState = 'none' | 'upcoming' | 'soon' | 'overdue';

export interface DeadlineStatus {
  state: DeadlineState;
  /** 期限までの日数（当日は 0、過ぎていれば負）。期限が無ければ null */
  daysLeft: number | null;
}

export const deadlineStatus = (deadline: string | null, today: string): DeadlineStatus => {
  if (!deadline) return { state: 'none', daysLeft: null };
  const daysLeft = diffDays(today, deadline);
  if (daysLeft < 0) return { state: 'overdue', daysLeft };
  return { state: daysLeft <= DEADLINE_SOON_DAYS ? 'soon' : 'upcoming', daysLeft };
};

/** 入力した調達額が、回次の「適格資金調達の金額」に届くか。どちらかが無ければ unknown */
export type QualifiedState = 'reached' | 'not_reached' | 'unknown';

export const qualifiedFinancingState = (
  round: Pick<ConvertibleRound, 'qualifiedFinancingAmount'>,
  newMoney: number | null,
): QualifiedState => {
  if (round.qualifiedFinancingAmount == null || newMoney == null || !(newMoney > 0)) return 'unknown';
  return newMoney >= round.qualifiedFinancingAmount ? 'reached' : 'not_reached';
};

export interface InvestmentView {
  investment: ConvertibleInvestment;
  holderName: string;
  converted: boolean;
  /** 未転換の投資の、転換株式数の概算。転換価額を決められないとき・転換済みは null */
  estimatedShares: number | null;
  /** 転換済みの投資について、株式の異動（転換）が記録されているか */
  hasTransaction: boolean;
}

export interface RoundView {
  round: ConvertibleRound;
  investments: InvestmentView[];
  totalAmount: number;
  /** 未転換の投資額（状態が「未転換」の回次だけ） */
  outstandingAmount: number;
  /** 転換済みとして記録した株式数の合計 */
  convertedShares: number;
  /** 転換の概算（未転換の投資が無い・状態が未転換でない回次は null） */
  conversion: ConversionDetail | null;
  /** 転換期限の状態（未転換の残高がある回次だけ判定する） */
  deadline: DeadlineStatus;
  qualified: QualifiedState;
}

/** 転換を株式の異動（転換）にも記録してあるか。同じ株主・同じ株式数の転換の異動を探す */
export const findConversionTransaction = (
  transactions: readonly ShareTransaction[],
  investment: Pick<ConvertibleInvestment, 'stakeholderId' | 'convertedShares' | 'convertedOn'>,
): ShareTransaction | null =>
  transactions.find(
    (transaction) =>
      transaction.transactionType === 'conversion' &&
      transaction.stakeholderId === investment.stakeholderId &&
      transaction.shares === investment.convertedShares &&
      (investment.convertedOn == null || transaction.transactionDate === investment.convertedOn),
  ) ?? null;

/** 回次ごとに、投資と転換の概算をまとめる。table は buildCapTable(snapshot, { scenario }) の結果 */
export const buildRoundViews = (
  snapshot: EquitySnapshot,
  table: Pick<CapTable, 'conversions'>,
  today: string,
  newMoney: number | null = null,
): RoundView[] => {
  const nameById = new Map(snapshot.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder.name]));
  const conversionByRound = new Map(table.conversions.map((conversion) => [conversion.roundId, conversion]));

  return [...snapshot.convertibleRounds]
    .sort((a, b) => a.roundNo - b.roundNo)
    .map((round) => {
      const conversion = conversionByRound.get(round.id) ?? null;
      const estimateById = new Map((conversion?.investments ?? []).map((detail) => [detail.investmentId, detail.shares]));
      const priceKnown = (conversion?.conversionPrice ?? 0) > 0;
      const investments: InvestmentView[] = snapshot.convertibleInvestments
        .filter((investment) => investment.roundId === round.id)
        .map((investment) => {
          const converted = investment.convertedShares != null;
          return {
            investment,
            holderName: nameById.get(investment.stakeholderId) ?? '（不明な権利者）',
            converted,
            estimatedShares: !converted && priceKnown ? (estimateById.get(investment.id) ?? null) : null,
            hasTransaction: converted && findConversionTransaction(snapshot.shareTransactions, investment) != null,
          };
        });
      const outstandingAmount =
        round.status === 'outstanding'
          ? investments.reduce((total, view) => total + (view.converted ? 0 : view.investment.amount), 0)
          : 0;
      return {
        round,
        investments,
        totalAmount: investments.reduce((total, view) => total + view.investment.amount, 0),
        outstandingAmount,
        convertedShares: investments.reduce((total, view) => total + (view.investment.convertedShares ?? 0), 0),
        conversion,
        deadline: outstandingAmount > 0 ? deadlineStatus(round.conversionDeadline, today) : { state: 'none', daysLeft: null },
        qualified: qualifiedFinancingState(round, newMoney),
      };
    });
};

export interface ConvertibleTotals {
  totalAmount: number;
  outstandingAmount: number;
  /** 未転換分の転換株式数の概算 */
  estimatedShares: number;
  /** 概算を出せない回次（キャップなし かつ 次回調達の単価が未入力）がある */
  hasUndetermined: boolean;
  /** 未転換の残高がある回次のうち、いちばん早い転換期限 */
  nextDeadline: { roundName: string; date: string; status: DeadlineStatus } | null;
}

export const summarizeRounds = (views: readonly RoundView[]): ConvertibleTotals => {
  const totals: ConvertibleTotals = {
    totalAmount: 0,
    outstandingAmount: 0,
    estimatedShares: 0,
    hasUndetermined: false,
    nextDeadline: null,
  };
  for (const view of views) {
    totals.totalAmount += view.totalAmount;
    totals.outstandingAmount += view.outstandingAmount;
    if (view.outstandingAmount > 0) {
      totals.estimatedShares += view.conversion?.totalShares ?? 0;
      if (!view.conversion || view.conversion.basis === 'undetermined') totals.hasUndetermined = true;
      const date = view.round.conversionDeadline;
      if (date && (!totals.nextDeadline || date < totals.nextDeadline.date)) {
        totals.nextDeadline = { roundName: view.round.name, date, status: view.deadline };
      }
    }
  }
  return totals;
};

/** 転換を株式の異動に記録するときのフォームの初期値（表示値）。株式の種類は契約で決まるため利用者が選ぶ */
export const conversionTransactionDefaults = (
  round: Pick<ConvertibleRound, 'name'>,
  investment: Pick<ConvertibleInvestment, 'stakeholderId' | 'amount' | 'convertedShares' | 'convertedOn'>,
): Record<string, string> => {
  const shares = investment.convertedShares ?? 0;
  return {
    stakeholderId: investment.stakeholderId,
    transactionType: 'conversion',
    transactionDate: investment.convertedOn ?? '',
    shares: shares > 0 ? shares.toLocaleString('ja-JP') : '',
    // 転換では新たな払込みは無く、払込済みの投資額が株式の対価になる
    amount: investment.amount.toLocaleString('ja-JP'),
    notes: `${round.name}の転換`,
  };
};
