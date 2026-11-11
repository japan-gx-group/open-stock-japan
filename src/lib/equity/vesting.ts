// ストックオプションのベスティング（権利確定）の計算。サーバ依存なし。
// ベスティングは会社法上の概念ではなく、割当契約・発行要項で定める行使条件。ここでは一般的な
// 「クリフ ＋ 均等」の形だけを扱い、それ以外（業績条件・上場後の段階的な行使制限など）は行使条件の文面で管理する。

import { addMonths, fullMonthsBetween } from './format';
import type { OptionGrant, OptionPlan, VestingInterval } from './types';

const INTERVAL_MONTHS: Record<VestingInterval, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export interface VestingStatus {
  /** ベスティングの起算日。決められないときは null（全量を確定済みとして扱う） */
  startOn: string | null;
  /** 確定済みの個数（行使・失効を引く前） */
  vestedUnits: number;
  unvestedUnits: number;
  /** 全量が確定する日 */
  fullyVestedOn: string | null;
  /** クリフが明ける日 */
  cliffOn: string | null;
}

export const vestingStartOf = (
  grant: Pick<OptionGrant, 'vestingStartOn' | 'grantedOn'>,
  plan: Pick<OptionPlan, 'allotmentDate'>,
): string | null => grant.vestingStartOn ?? grant.grantedOn ?? plan.allotmentDate ?? null;

export const vestingStatus = (
  grant: Pick<OptionGrant, 'units' | 'vestingStartOn' | 'grantedOn'>,
  plan: Pick<OptionPlan, 'allotmentDate' | 'vestingMonths' | 'cliffMonths' | 'vestingInterval'>,
  asOf: string,
): VestingStatus => {
  const startOn = vestingStartOf(grant, plan);
  const total = plan.vestingMonths ?? 0;
  if (!startOn || total <= 0) {
    return { startOn, vestedUnits: grant.units, unvestedUnits: 0, fullyVestedOn: startOn, cliffOn: null };
  }
  const cliff = Math.min(plan.cliffMonths ?? 0, total);
  const step = INTERVAL_MONTHS[plan.vestingInterval] ?? 1;
  const elapsed = fullMonthsBetween(startOn, asOf);
  const cliffOn = cliff > 0 ? addMonths(startOn, cliff) : null;
  const fullyVestedOn = addMonths(startOn, total);

  let vestedUnits: number;
  if (asOf < startOn || elapsed < cliff) {
    vestedUnits = 0;
  } else if (elapsed >= total) {
    vestedUnits = grant.units;
  } else {
    // 区切り（毎月 / 3 か月 / 1 年）ごとに確定する。端数の個数は切り捨て、最終回でまとめて確定する。
    const steppedMonths = Math.floor(elapsed / step) * step;
    vestedUnits = Math.floor((grant.units * Math.max(steppedMonths, cliff)) / total);
  }
  return { startOn, vestedUnits, unvestedUnits: grant.units - vestedUnits, fullyVestedOn, cliffOn };
};

/** 今行使できる個数（確定済み − 行使済み − 失効。行使期間の内外は見ない） */
export const exercisableUnits = (vestedUnits: number, exercisedUnits: number, forfeitedUnits: number, totalUnits: number): number =>
  Math.max(0, Math.min(vestedUnits, totalUnits - forfeitedUnits) - exercisedUnits);

export type ExercisePeriodState = 'unset' | 'before' | 'open' | 'closed';

export const exercisePeriodState = (
  plan: Pick<OptionPlan, 'exercisePeriodStart' | 'exercisePeriodEnd'>,
  asOf: string,
): ExercisePeriodState => {
  if (!plan.exercisePeriodStart && !plan.exercisePeriodEnd) return 'unset';
  if (plan.exercisePeriodStart && asOf < plan.exercisePeriodStart) return 'before';
  if (plan.exercisePeriodEnd && asOf > plan.exercisePeriodEnd) return 'closed';
  return 'open';
};
