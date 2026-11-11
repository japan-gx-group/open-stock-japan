// 資金調達ラウンドと株式の種類の一覧のための集計。期限・資本金・登録免許税の数値は src/lib/legal/rules.ts を使う。

import { buildCapTable } from '@/lib/equity/capTable';
import { diffDays } from '@/lib/equity/format';
import type { EquitySnapshot, FundingRound, ShareClass, ShareTransaction } from '@/lib/equity/types';
import { capitalIncreaseRegistrationTax, minimumCapitalIncrease, registrationDeadline } from '@/lib/legal/rules';

export type RegistrationState =
  /** 払込期日が未定、または計画中で登記の期限がまだ無い */
  | 'not_applicable'
  | 'registered'
  | 'pending'
  | 'overdue';

export interface RoundRegistration {
  state: RegistrationState;
  /** 変更の登記の期限（払込期日から 2 週間） */
  deadline: string | null;
  /** 今日から期限までの日数（過ぎていれば負） */
  daysLeft: number | null;
  registeredOn: string | null;
  /** 登記した日が期限を過ぎていた */
  registeredLate: boolean;
}

export interface RoundAllotment {
  transaction: ShareTransaction;
  stakeholderName: string;
  shareClassName: string;
  amount: number;
}

export interface RoundSummary {
  round: FundingRound;
  shareClassName: string;
  allotments: RoundAllotment[];
  sharesIssued: number;
  /** ラウンドに紐づく株式の異動から求めた払込額の合計 */
  amountRaised: number;
  /** 調達額（予定）に対する払込額の割合。予定が無ければ null */
  progress: number | null;
  /** プレマネー ＋ 払込額（払込みが無ければ予定額）。プレマネーが未入力なら null */
  postMoney: number | null;
  /** postMoney に払込額ではなく予定額を使った */
  postMoneyIsPlanned: boolean;
  registration: RoundRegistration;
  /** 資本金・登録免許税の目安の基にした払込額（実績。無ければ予定） */
  capitalBasis: number | null;
  /** 資本金に計上する最低額（払込額の 2 分の 1） */
  minimumCapital: number | null;
  /** 登録免許税の目安の基にした、増加する資本金の額（入力値。無ければ最低額） */
  capitalIncrease: number | null;
  registrationTax: number | null;
}

const allotmentAmount = (transaction: ShareTransaction): number =>
  transaction.amount ?? (transaction.pricePerShare != null ? Math.round(transaction.pricePerShare * transaction.shares) : 0);

const registrationOf = (round: FundingRound, today: string): RoundRegistration => {
  if (!round.closingDate || (round.status !== 'closed' && !round.registrationDate)) {
    return { state: 'not_applicable', deadline: round.closingDate ? registrationDeadline(round.closingDate) : null, daysLeft: null, registeredOn: round.registrationDate, registeredLate: false };
  }
  const deadline = registrationDeadline(round.closingDate);
  if (round.registrationDate) {
    return { state: 'registered', deadline, daysLeft: null, registeredOn: round.registrationDate, registeredLate: round.registrationDate > deadline };
  }
  const daysLeft = diffDays(today, deadline);
  return { state: daysLeft < 0 ? 'overdue' : 'pending', deadline, daysLeft, registeredOn: null, registeredLate: false };
};

export const summarizeRounds = (snapshot: EquitySnapshot, today: string): RoundSummary[] => {
  const stakeholderById = new Map(snapshot.stakeholders.map((item) => [item.id, item.name]));
  const classById = new Map(snapshot.shareClasses.map((item) => [item.id, item.name]));

  return snapshot.fundingRounds.map((round) => {
    const allotments = snapshot.shareTransactions
      .filter((transaction) => transaction.roundId === round.id)
      .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || b.shares - a.shares)
      .map((transaction) => ({
        transaction,
        stakeholderName: stakeholderById.get(transaction.stakeholderId) ?? '（不明な株主）',
        shareClassName: classById.get(transaction.shareClassId) ?? '（不明な種類）',
        amount: allotmentAmount(transaction),
      }));
    const amountRaised = allotments.reduce((total, allotment) => total + allotment.amount, 0);
    const capitalBasis = amountRaised > 0 ? amountRaised : round.targetAmount;
    const minimumCapital = capitalBasis != null && capitalBasis > 0 ? minimumCapitalIncrease(capitalBasis) : null;
    const capitalIncrease = round.capitalIncreaseAmount ?? minimumCapital;
    const postMoneyIsPlanned = amountRaised <= 0;
    return {
      round,
      shareClassName: round.shareClassId ? (classById.get(round.shareClassId) ?? '（不明な種類）') : '',
      allotments,
      sharesIssued: allotments.reduce((total, allotment) => total + allotment.transaction.shares, 0),
      amountRaised,
      progress: round.targetAmount != null && round.targetAmount > 0 ? amountRaised / round.targetAmount : null,
      postMoney: round.preMoneyValuation != null ? round.preMoneyValuation + (postMoneyIsPlanned ? (round.targetAmount ?? 0) : amountRaised) : null,
      postMoneyIsPlanned,
      registration: registrationOf(round, today),
      capitalBasis: capitalBasis != null && capitalBasis > 0 ? capitalBasis : null,
      minimumCapital,
      capitalIncrease,
      registrationTax: capitalIncrease != null && capitalIncrease > 0 ? capitalIncreaseRegistrationTax(capitalIncrease) : null,
    };
  });
};

export interface ShareClassSummary {
  shareClass: ShareClass;
  issuedShares: number;
  holderCount: number;
  /** 発行可能種類株式総数に対する発行済みの割合。未設定は null */
  authorizedUsage: number | null;
  exceedsAuthorized: boolean;
}

export const summarizeShareClasses = (snapshot: EquitySnapshot): ShareClassSummary[] => {
  const table = buildCapTable(snapshot, { includeUnallocatedPool: false });
  const totalById = new Map(table.classes.map((item) => [item.shareClassId, item]));
  return [...snapshot.shareClasses]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja'))
    .map((shareClass) => {
      const issuedShares = totalById.get(shareClass.id)?.issuedShares ?? 0;
      const authorized = shareClass.authorizedShares;
      return {
        shareClass,
        issuedShares,
        holderCount: totalById.get(shareClass.id)?.holderCount ?? 0,
        authorizedUsage: authorized != null && authorized > 0 ? issuedShares / authorized : null,
        exceedsAuthorized: authorized != null && issuedShares > authorized,
      };
    });
};
