// ストックオプション画面の集計。サーバ依存なし。
// 個数の計算・ベスティング・期限そのものは src/lib/equity と src/lib/legal の関数を使い、
// ここでは画面に並べる形（回次ごと・割当ごと・原簿の行）にまとめるだけにする。

import { buildCapTable, grantEventTotals, grantRemainingUnits } from '@/lib/equity/capTable';
import { addMonths, formatDateJa, formatYen, formatYenJa } from '@/lib/equity/format';
import {
  CAP_BASES,
  optionLabel,
  type EquitySnapshot,
  type OptionEvent,
  type OptionGrant,
  type OptionPlan,
  type ShareTransaction,
  type Stakeholder,
} from '@/lib/equity/types';
import {
  exercisableUnits,
  exercisePeriodState,
  vestingStartOf,
  vestingStatus,
  type ExercisePeriodState,
  type VestingStatus,
} from '@/lib/equity/vesting';
import { registrationDeadline } from '@/lib/legal/rules';

export type VestingMilestone =
  /** ベスティングの定めが無い、または起算日が決められない */
  | { kind: 'none'; date: null }
  /** クリフ明け待ち */
  | { kind: 'cliff'; date: string }
  /** クリフは明けた。全量確定待ち */
  | { kind: 'full'; date: string }
  /** 全量確定済み */
  | { kind: 'done'; date: string | null };

export interface GrantView {
  grant: OptionGrant;
  plan: OptionPlan;
  stakeholder: Stakeholder | null;
  holderName: string;
  events: OptionEvent[];
  exercisedUnits: number;
  forfeitedUnits: number;
  /** 残数（割当 − 行使 − 失効） */
  remainingUnits: number;
  remainingShares: number;
  vesting: VestingStatus;
  milestone: VestingMilestone;
  /** 確定済み − 行使済み（失効分を超えない）。行使期間・行使条件は見ていない */
  exercisableUnits: number;
  /** 新株予約権者となった日（割当日。会社法245条1項） */
  acquiredOn: string | null;
}

export type RegistrationState = 'registered' | 'pending' | 'overdue' | 'unknown';

export interface PlanView {
  plan: OptionPlan;
  grants: GrantView[];
  /** 割当個数の合計（失効・行使を引く前） */
  grantedUnits: number;
  exercisedUnits: number;
  forfeitedUnits: number;
  /** 未行使の残数 */
  remainingUnits: number;
  /** 発行総数 − 割当個数。失効した分は消滅する（会社法287条）ので未割当には戻さない */
  unallocatedUnits: number;
  /** 割当個数が発行総数を超えている個数（入力の誤りの検出用。通常は 0） */
  overAllocatedUnits: number;
  periodState: ExercisePeriodState;
  registration: { state: RegistrationState; deadline: string | null };
}

export interface OptionTotals {
  totalUnits: number;
  totalShares: number;
  grantedUnits: number;
  grantedShares: number;
  unallocatedUnits: number;
  unallocatedShares: number;
  remainingUnits: number;
  remainingShares: number;
  exercisedUnits: number;
  exercisedShares: number;
  forfeitedUnits: number;
  forfeitedShares: number;
}

const milestoneOf = (vesting: VestingStatus, hasSchedule: boolean, today: string): VestingMilestone => {
  if (!hasSchedule || !vesting.startOn || !vesting.fullyVestedOn) return { kind: 'none', date: null };
  if (vesting.unvestedUnits === 0) return { kind: 'done', date: vesting.fullyVestedOn };
  if (vesting.cliffOn && today < vesting.cliffOn) return { kind: 'cliff', date: vesting.cliffOn };
  return { kind: 'full', date: vesting.fullyVestedOn };
};

/** 回次ごとに、割当と個数の内訳をまとめる（today 時点） */
export const buildPlanViews = (snapshot: EquitySnapshot, today: string): PlanView[] => {
  const stakeholderById = new Map(snapshot.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder]));
  const totals = grantEventTotals(snapshot.optionEvents);
  const eventsByGrant = new Map<string, OptionEvent[]>();
  for (const event of snapshot.optionEvents) {
    const list = eventsByGrant.get(event.grantId) ?? [];
    list.push(event);
    eventsByGrant.set(event.grantId, list);
  }

  return snapshot.optionPlans.map((plan) => {
    const grants: GrantView[] = snapshot.optionGrants
      .filter((grant) => grant.planId === plan.id)
      .map((grant) => {
        const used = totals.get(grant.id) ?? { exercised: 0, forfeited: 0 };
        const remainingUnits = grantRemainingUnits(grant, totals);
        const vesting = vestingStatus(grant, plan, today);
        const stakeholder = stakeholderById.get(grant.stakeholderId) ?? null;
        return {
          grant,
          plan,
          stakeholder,
          holderName: stakeholder?.name ?? '（不明な権利者）',
          events: [...(eventsByGrant.get(grant.id) ?? [])].sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
          exercisedUnits: used.exercised,
          forfeitedUnits: used.forfeited,
          remainingUnits,
          remainingShares: remainingUnits * plan.sharesPerUnit,
          vesting,
          milestone: milestoneOf(vesting, (plan.vestingMonths ?? 0) > 0, today),
          exercisableUnits: exercisableUnits(vesting.vestedUnits, used.exercised, used.forfeited, grant.units),
          acquiredOn: grant.grantedOn ?? plan.allotmentDate ?? null,
        };
      });

    const sumOf = (pick: (view: GrantView) => number): number => grants.reduce((total, view) => total + pick(view), 0);
    const grantedUnits = sumOf((view) => view.grant.units);
    const deadline = plan.allotmentDate ? registrationDeadline(plan.allotmentDate) : null;
    const state: RegistrationState = plan.registeredOn
      ? 'registered'
      : deadline == null
        ? 'unknown'
        : today > deadline
          ? 'overdue'
          : 'pending';

    return {
      plan,
      grants,
      grantedUnits,
      exercisedUnits: sumOf((view) => view.exercisedUnits),
      forfeitedUnits: sumOf((view) => view.forfeitedUnits),
      remainingUnits: sumOf((view) => view.remainingUnits),
      unallocatedUnits: Math.max(0, plan.totalUnits - grantedUnits),
      overAllocatedUnits: Math.max(0, grantedUnits - plan.totalUnits),
      periodState: exercisePeriodState(plan, today),
      registration: { state, deadline },
    };
  });
};

export const summarizePlans = (views: readonly PlanView[]): OptionTotals => {
  const totals: OptionTotals = {
    totalUnits: 0,
    totalShares: 0,
    grantedUnits: 0,
    grantedShares: 0,
    unallocatedUnits: 0,
    unallocatedShares: 0,
    remainingUnits: 0,
    remainingShares: 0,
    exercisedUnits: 0,
    exercisedShares: 0,
    forfeitedUnits: 0,
    forfeitedShares: 0,
  };
  for (const view of views) {
    const perUnit = view.plan.sharesPerUnit;
    totals.totalUnits += view.plan.totalUnits;
    totals.totalShares += view.plan.totalUnits * perUnit;
    totals.grantedUnits += view.grantedUnits;
    totals.grantedShares += view.grantedUnits * perUnit;
    totals.unallocatedUnits += view.unallocatedUnits;
    totals.unallocatedShares += view.unallocatedUnits * perUnit;
    totals.remainingUnits += view.remainingUnits;
    totals.remainingShares += view.remainingUnits * perUnit;
    totals.exercisedUnits += view.exercisedUnits;
    totals.exercisedShares += view.exercisedUnits * perUnit;
    totals.forfeitedUnits += view.forfeitedUnits;
    totals.forfeitedShares += view.forfeitedUnits * perUnit;
  }
  return totals;
};

/**
 * 大口株主の判定に使う基準日。条文は「付与決議のあった日」の持株で判定する（措令19条の3第3項）ため発行決議日を使い、
 * 未入力なら割当日で代える。どちらも無ければ null。
 */
export const majorShareholderCheckDate = (
  plan: Pick<OptionPlan, 'resolutionDate' | 'allotmentDate'>,
  grant: Pick<OptionGrant, 'grantedOn'>,
): string | null => plan.resolutionDate ?? grant.grantedOn ?? plan.allotmentDate ?? null;

/**
 * 基準日における、発行済株式に対する持株比率。基準日が無い・その日の発行済株式が 0 のときは null（判定できない）。
 * 株式を持っていなければ 0。
 */
export const holdingRatioAt = (snapshot: EquitySnapshot, stakeholderId: string, date: string | null): number | null => {
  if (!date) return null;
  const table = buildCapTable(snapshot, { asOf: date });
  if (table.totals.issuedShares <= 0) return null;
  return table.rows.find((row) => row.stakeholderId === stakeholderId)?.issuedRatio ?? 0;
};

export interface VestingPoint {
  date: string;
  vestedUnits: number;
}

/** ベスティングの予定（確定個数が変わる日だけを並べる）。ベスティングの定めが無ければ空 */
export const vestingSchedule = (
  grant: Pick<OptionGrant, 'units' | 'vestingStartOn' | 'grantedOn'>,
  plan: Pick<OptionPlan, 'allotmentDate' | 'vestingMonths' | 'cliffMonths' | 'vestingInterval'>,
): VestingPoint[] => {
  const months = plan.vestingMonths ?? 0;
  const start = vestingStartOf(grant, plan);
  if (!start || months <= 0) return [];
  const points: VestingPoint[] = [{ date: start, vestedUnits: 0 }];
  for (let month = 1; month <= months; month += 1) {
    const date = addMonths(start, month);
    const vestedUnits = vestingStatus(grant, plan, date).vestedUnits;
    if (vestedUnits !== points[points.length - 1].vestedUnits) points.push({ date, vestedUnits });
  }
  return points;
};

export interface WarrantRegisterRow {
  key: string;
  stakeholderId: string;
  /** 新株予約権者の氏名又は名称（会社法249条3号イ） */
  holderName: string;
  /** 住所（同イ） */
  address: string;
  /** 回次の名称 */
  planName: string;
  /** 新株予約権の内容（同ロ） */
  content: string;
  /** 数（同ロ）。台帳に個数が無いもの（転換型）は null */
  units: number | null;
  /** 取得した日（同ハ） */
  acquiredOn: string | null;
  note: string;
}

const addressOf = (stakeholder: Stakeholder | null | undefined): string =>
  stakeholder ? [stakeholder.postalCode ? `〒${stakeholder.postalCode}` : '', stakeholder.address].filter(Boolean).join(' ') : '';

/**
 * 新株予約権原簿（会社法249条）の行。残数のある割当と、未転換の転換型（J-KISS 型新株予約権など）を並べる。
 * 行使・失効で残数が 0 になった割当は、新株予約権者ではなくなっているので載せない。
 */
export const buildWarrantRegister = (snapshot: EquitySnapshot, today: string): WarrantRegisterRow[] => {
  const classNameById = new Map(snapshot.shareClasses.map((shareClass) => [shareClass.id, shareClass.name]));
  const stakeholderById = new Map(snapshot.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder]));
  const rows: WarrantRegisterRow[] = [];

  for (const view of buildPlanViews(snapshot, today)) {
    const { plan } = view;
    const className = plan.shareClassId ? (classNameById.get(plan.shareClassId) ?? '株式') : '株式';
    const period =
      plan.exercisePeriodStart || plan.exercisePeriodEnd
        ? `${formatDateJa(plan.exercisePeriodStart)}〜${formatDateJa(plan.exercisePeriodEnd)}`
        : '未設定';
    const content = `目的: 1 個につき${className} ${plan.sharesPerUnit.toLocaleString('ja-JP')}株／行使価額: 1 株 ${formatYen(plan.exercisePrice, 2)}／行使期間: ${period}`;
    for (const grant of view.grants) {
      if (grant.remainingUnits <= 0) continue;
      rows.push({
        key: `grant:${grant.grant.id}`,
        stakeholderId: grant.grant.stakeholderId,
        holderName: grant.holderName,
        address: addressOf(grant.stakeholder),
        planName: plan.name,
        content,
        units: grant.remainingUnits,
        acquiredOn: grant.acquiredOn,
        note:
          grant.exercisedUnits + grant.forfeitedUnits > 0
            ? `当初 ${grant.grant.units.toLocaleString('ja-JP')}個（行使 ${grant.exercisedUnits.toLocaleString('ja-JP')}個・失効 ${grant.forfeitedUnits.toLocaleString('ja-JP')}個）`
            : '',
      });
    }
  }

  for (const round of snapshot.convertibleRounds) {
    if (round.status !== 'outstanding' || round.instrumentType === 'other') continue;
    const terms = [
      round.valuationCap != null
        ? `評価上限額 ${formatYenJa(round.valuationCap)}（${optionLabel(CAP_BASES, round.capBasis)}）`
        : '評価上限額なし',
      `ディスカウント ${Math.round(round.discountRate * 10_000) / 100}%`,
      round.conversionDeadline ? `転換期限 ${formatDateJa(round.conversionDeadline)}` : '',
    ].filter(Boolean);
    for (const investment of snapshot.convertibleInvestments) {
      if (investment.roundId !== round.id || investment.convertedShares != null) continue;
      const stakeholder = stakeholderById.get(investment.stakeholderId);
      rows.push({
        key: `convertible:${investment.id}`,
        stakeholderId: investment.stakeholderId,
        holderName: stakeholder?.name ?? '（不明な権利者）',
        address: addressOf(stakeholder),
        planName: round.name,
        content: terms.join('／'),
        units: null,
        acquiredOn: investment.investmentDate ?? round.issueDate ?? null,
        note: `払込金額 ${formatYenJa(investment.amount)}。個数は発行要項・契約書で確認してください`,
      });
    }
  }

  return rows.sort(
    (a, b) =>
      a.holderName.localeCompare(b.holderName, 'ja') ||
      (a.acquiredOn ?? '').localeCompare(b.acquiredOn ?? '') ||
      a.planName.localeCompare(b.planName, 'ja'),
  );
};

/** 行使を株式の異動（新株予約権の行使）にも記録してあるか。同じ株主・同じ日・同じ株式数の異動を探す */
export const findExerciseTransaction = (
  transactions: readonly ShareTransaction[],
  stakeholderId: string,
  eventDate: string,
  shares: number,
): ShareTransaction | null =>
  transactions.find(
    (transaction) =>
      transaction.transactionType === 'exercise' &&
      transaction.stakeholderId === stakeholderId &&
      transaction.transactionDate === eventDate &&
      transaction.shares === shares,
  ) ?? null;

/** 行使を株式の異動に記録するときのフォームの初期値（表示値） */
export const exerciseTransactionDefaults = (
  plan: Pick<OptionPlan, 'name' | 'shareClassId' | 'sharesPerUnit' | 'exercisePrice'>,
  stakeholderId: string,
  eventDate: string,
  units: number,
): Record<string, string> => {
  const shares = units * plan.sharesPerUnit;
  return {
    stakeholderId,
    shareClassId: plan.shareClassId ?? '',
    transactionType: 'exercise',
    transactionDate: eventDate,
    shares: shares.toLocaleString('ja-JP'),
    pricePerShare: String(plan.exercisePrice),
    amount: Math.round(shares * plan.exercisePrice).toLocaleString('ja-JP'),
    notes: `${plan.name}の行使（${units.toLocaleString('ja-JP')}個）`,
  };
};
