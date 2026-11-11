// 税制適格ストックオプション（租税特別措置法29条の2）の要件チェック。サーバ依存なし。
//
// 台帳から機械的に確かめられる項目だけを判定し、確かめられない項目（保管委託・付与契約の文言など）は
// 「確認が必要」として一覧に出す。適格かどうかの最終判断は税理士・弁護士に確認する前提。
// 数値の根拠と確認状況は docs/legal/03-stock-options.md と docs/legal/rules.md。

import { addDays, addYears, formatYenJa } from '@/lib/equity/format';
import type { EquitySnapshot, OptionGrant, OptionPlan } from '@/lib/equity/types';

export const TAX_QUALIFIED = {
  /** 権利行使期間の開始: 付与決議の日後 2 年を経過した日以後 */
  exerciseStartYearsAfterResolution: 2,
  /** 権利行使期間の終了: 付与決議の日後 10 年を経過する日まで */
  exerciseEndYearsAfterResolution: 10,
  /** 設立 5 年未満の非上場会社は 15 年を経過する日まで */
  exerciseEndYearsYoungCompany: 15,
  youngCompanyYears: 5,
  /** 年間の権利行使価額の上限（円） */
  annualLimit: 12_000_000,
  /** 付与決議の日に設立 5 年未満の会社が付与したもの */
  annualLimitUnder5Years: 24_000_000,
  /** 付与決議の日に設立 5 年以上 20 年未満の非上場会社（または上場後 5 年未満の上場会社）が付与したもの */
  annualLimit5To20Years: 36_000_000,
  matureCompanyYears: 20,
  /** 大口株主（非上場会社）: 発行済株式の 3 分の 1 を超えて保有する者 */
  majorShareholderRatioUnlisted: 1 / 3,
} as const;

export type RequirementStatus = 'ok' | 'ng' | 'check';

export interface RequirementResult {
  key: string;
  title: string;
  status: RequirementStatus;
  message: string;
  basis: string;
}

export interface TaxQualifiedContext {
  /** 会社の設立日（organizations.establishedOn）。未設定は null */
  establishedOn: string | null;
  isListed?: boolean;
}

/** 付与決議の日における設立からの経過年数（満年数）。設立日が分からなければ null */
const companyAgeYears = (establishedOn: string | null, resolutionDate: string | null): number | null => {
  if (!establishedOn || !resolutionDate || resolutionDate < establishedOn) return null;
  let years = Number(resolutionDate.slice(0, 4)) - Number(establishedOn.slice(0, 4));
  if (addYears(establishedOn, years) > resolutionDate) years -= 1;
  return years;
};

/** この回次に適用される年間の権利行使価額の上限 */
export const annualExerciseLimit = (plan: Pick<OptionPlan, 'resolutionDate'>, context: TaxQualifiedContext): { limit: number; reason: string } => {
  const age = companyAgeYears(context.establishedOn, plan.resolutionDate);
  if (age == null) {
    return { limit: TAX_QUALIFIED.annualLimit, reason: '設立日または発行決議日が未入力のため、原則の上限で計算しています' };
  }
  if (age < TAX_QUALIFIED.youngCompanyYears) {
    return { limit: TAX_QUALIFIED.annualLimitUnder5Years, reason: '付与決議の日に設立 5 年未満（上場・非上場を問わない）' };
  }
  if (age < TAX_QUALIFIED.matureCompanyYears && !context.isListed) {
    return { limit: TAX_QUALIFIED.annualLimit5To20Years, reason: '付与決議の日に設立 5 年以上 20 年未満の非上場会社' };
  }
  return { limit: TAX_QUALIFIED.annualLimit, reason: '原則' };
};

/** 回次（発行要項）単位の要件チェック */
export const checkPlanRequirements = (plan: OptionPlan, context: TaxQualifiedContext): RequirementResult[] => {
  const results: RequirementResult[] = [];
  const basis = '租税特別措置法29条の2第1項';

  // 無償発行
  results.push({
    key: 'issue_price',
    title: '金銭の払込みをさせないで発行していること',
    status: plan.issuePrice === 0 ? 'ok' : 'ng',
    message:
      plan.issuePrice === 0
        ? '発行価額は無償です。'
        : '発行価額が設定されています。払込みをさせて発行する新株予約権（有償ストックオプション）は税制適格の対象になりません。',
    basis,
  });

  // 権利行使期間
  if (!plan.resolutionDate || !plan.exercisePeriodStart || !plan.exercisePeriodEnd) {
    results.push({
      key: 'exercise_period',
      title: '権利行使期間が付与決議の日後 2 年を経過した日から 10 年を経過する日までであること',
      status: 'check',
      message: '発行決議日と行使期間を入力すると判定します。',
      basis: `${basis}1号`,
    });
  } else {
    const age = companyAgeYears(context.establishedOn, plan.resolutionDate);
    const young = age != null && age < TAX_QUALIFIED.youngCompanyYears && !context.isListed;
    const earliestStart = addDays(addYears(plan.resolutionDate, TAX_QUALIFIED.exerciseStartYearsAfterResolution), 1);
    const latestEnd = addYears(
      plan.resolutionDate,
      young ? TAX_QUALIFIED.exerciseEndYearsYoungCompany : TAX_QUALIFIED.exerciseEndYearsAfterResolution,
    );
    const startOk = plan.exercisePeriodStart >= earliestStart;
    const endOk = plan.exercisePeriodEnd <= latestEnd;
    const limitLabel = young ? '15 年（設立 5 年未満の非上場会社）' : '10 年';
    results.push({
      key: 'exercise_period',
      title: `権利行使期間が付与決議の日後 2 年を経過した日から ${limitLabel}を経過する日までであること`,
      status: startOk && endOk ? 'ok' : 'ng',
      message:
        startOk && endOk
          ? `行使期間は ${earliestStart} 以後・${latestEnd} 以前に収まっています。`
          : `行使期間は ${earliestStart} 以後に始まり、${latestEnd} までに終わる必要があります${
              age == null ? '（設立日が未入力のため 10 年で判定しています）' : ''
            }。`,
      basis: `${basis}1号`,
    });
  }

  // 行使価額 ≧ 付与契約時の時価
  if (plan.fairValuePerShare == null) {
    results.push({
      key: 'exercise_price',
      title: '1 株あたりの権利行使価額が付与契約締結時の 1 株あたりの価額以上であること',
      status: 'check',
      message:
        '付与契約時の 1 株あたりの時価を入力すると判定します。非上場会社は、財産評価基本通達の例による算定（純資産価額方式など）を使えます。',
      basis: `${basis}3号`,
    });
  } else {
    const ok = plan.exercisePrice >= plan.fairValuePerShare;
    results.push({
      key: 'exercise_price',
      title: '1 株あたりの権利行使価額が付与契約締結時の 1 株あたりの価額以上であること',
      status: ok ? 'ok' : 'ng',
      message: ok
        ? `行使価額（${plan.exercisePrice.toLocaleString('ja-JP')}円）は時価（${plan.fairValuePerShare.toLocaleString('ja-JP')}円）以上です。`
        : `行使価額（${plan.exercisePrice.toLocaleString('ja-JP')}円）が時価（${plan.fairValuePerShare.toLocaleString('ja-JP')}円）を下回っています。`,
      basis: `${basis}3号`,
    });
  }

  // 台帳からは確かめられない項目
  results.push(
    {
      key: 'non_transferable',
      title: '新株予約権を譲渡してはならないこととされていること',
      status: 'check',
      message: '付与契約・発行要項に譲渡禁止の定めがあることを確認してください。',
      basis: `${basis}4号`,
    },
    {
      key: 'custody',
      title: '行使で取得する株式の保管委託、または発行会社による株式の管理',
      status: 'check',
      message:
        '行使で取得した株式を証券会社等に保管委託するか、譲渡制限株式であれば発行会社が自ら管理する方法（令和 6 年度改正）をとることを確認してください。',
      basis: `${basis}6号`,
    },
    {
      key: 'report',
      title: '付与に関する調書の提出',
      status: 'check',
      message: '付与した日の属する年の翌年 1 月 31 日までに「特定新株予約権の付与に関する調書」を税務署へ提出します。',
      basis: '租税特別措置法29条の2第6項',
    },
  );

  return results;
};

export interface GrantCheckInput {
  plan: OptionPlan;
  grant: OptionGrant;
  /** 付与決議の日における割当先の持株比率（発行済株式に対する割合）。分からなければ null */
  holdingRatioAtGrant: number | null;
}

/** 割当先ごとの要件チェック（付与対象者・大口株主） */
export const checkGrantRequirements = ({ grant, holdingRatioAtGrant }: GrantCheckInput): RequirementResult[] => {
  const results: RequirementResult[] = [];
  const basis = '租税特別措置法29条の2第1項';

  if (grant.holderRole === 'advisor') {
    results.push({
      key: 'eligible_person',
      title: '付与対象者',
      status: 'check',
      message:
        '社外協力者は、認定を受けた計画に基づく「社外高度人材」に当たる場合だけ対象になります。認定の有無を確認してください。',
      basis,
    });
  } else if (grant.holderRole === 'other') {
    results.push({
      key: 'eligible_person',
      title: '付与対象者',
      status: 'ng',
      message: '付与対象者は、発行会社またはその子会社の取締役・執行役・使用人（および一定の社外高度人材）に限られます。監査役は対象外です。',
      basis,
    });
  } else {
    results.push({ key: 'eligible_person', title: '付与対象者', status: 'ok', message: '取締役・執行役・使用人への付与です。', basis });
  }

  if (holdingRatioAtGrant == null) {
    results.push({
      key: 'major_shareholder',
      title: '大口株主およびその特別関係者でないこと',
      status: 'check',
      message: '付与決議の日の持株比率を確認してください（非上場会社では発行済株式の 3 分の 1 超を保有する者とその親族等は対象外）。',
      basis,
    });
  } else {
    const ng = holdingRatioAtGrant > TAX_QUALIFIED.majorShareholderRatioUnlisted;
    results.push({
      key: 'major_shareholder',
      title: '大口株主およびその特別関係者でないこと',
      status: ng ? 'ng' : 'check',
      message: ng
        ? `付与決議の日に発行済株式の ${(holdingRatioAtGrant * 100).toFixed(1)}% を保有しています。3 分の 1 を超える大口株主は税制適格の対象になりません。`
        : `付与決議の日の持株比率は ${(holdingRatioAtGrant * 100).toFixed(1)}% です。大口株主の親族など特別関係者に当たらないことも確認してください。`,
      basis,
    });
  }

  return results;
};

export interface AnnualExerciseRow {
  stakeholderId: string;
  year: number;
  /** その年に行使した権利行使価額の合計（税制適格の回次だけ。実額） */
  amount: number;
  /** 上限の判定に使う額。回次ごとに実額を 1・2・3 で割り（1 回の行使ごとに 1 円未満切り上げ）、合計したもの */
  adjustedAmount: number;
  /** 判定の上限（1,200 万円） */
  limit: number;
  exceeded: boolean;
  message: string;
}

/** 上限の判定で権利行使価額を割る数（設立 5 年未満 = 2、5 年以上 20 年未満の非上場など = 3、それ以外 = 1） */
export const annualLimitDivisor = (plan: Pick<OptionPlan, 'resolutionDate'>, context: TaxQualifiedContext): number =>
  Math.round(annualExerciseLimit(plan, context).limit / TAX_QUALIFIED.annualLimit);

/**
 * 割当先 × 暦年ごとの権利行使価額の合計と、上限の判定。
 * 条文は「権利行使価額を 2（または 3）で割った額」の年間合計を 1,200 万円と比べる形で、区分は付与決議の日で決まる
 * （租税特別措置法29条の2第1項ただし書）。上限を超えることになる行使は、その行使の全体が非課税の対象外になる。
 * 他社から付与された税制適格ストックオプションの行使も通算されるが、ここでは自社分だけを数えている。
 */
export const annualExerciseAmounts = (snapshot: EquitySnapshot, context: TaxQualifiedContext): AnnualExerciseRow[] => {
  const planById = new Map(snapshot.optionPlans.map((plan) => [plan.id, plan]));
  const grantById = new Map(snapshot.optionGrants.map((grant) => [grant.id, grant]));
  const cells = new Map<string, { stakeholderId: string; year: number; amount: number; adjustedAmount: number }>();

  for (const event of snapshot.optionEvents) {
    if (event.eventType !== 'exercise') continue;
    const grant = grantById.get(event.grantId);
    const plan = grant ? planById.get(grant.planId) : undefined;
    if (!grant || !plan || plan.planType !== 'tax_qualified') continue;
    const year = Number(event.eventDate.slice(0, 4));
    const key = `${grant.stakeholderId}:${year}`;
    const cell = cells.get(key) ?? { stakeholderId: grant.stakeholderId, year, amount: 0, adjustedAmount: 0 };
    const amount = event.units * plan.sharesPerUnit * plan.exercisePrice;
    cell.amount += amount;
    cell.adjustedAmount += Math.ceil(amount / annualLimitDivisor(plan, context) - 1e-9);
    cells.set(key, cell);
  }

  const limit = TAX_QUALIFIED.annualLimit;
  return Array.from(cells.values())
    .sort((a, b) => b.year - a.year || a.stakeholderId.localeCompare(b.stakeholderId))
    .map((cell) => {
      const exceeded = cell.adjustedAmount > limit;
      const basis = cell.adjustedAmount === cell.amount ? '' : `（上限の判定に使う額は ${formatYenJa(cell.adjustedAmount)}）`;
      return {
        ...cell,
        limit,
        exceeded,
        message: exceeded
          ? `${cell.year} 年の権利行使価額の合計 ${formatYenJa(cell.amount)}${basis}が、年間の上限 ${formatYenJa(limit)} を超えています。超えることになる行使は、その行使の全体が税制適格の扱いを受けられません。`
          : `${cell.year} 年の権利行使価額の合計は ${formatYenJa(cell.amount)}${basis}です（年間の上限 ${formatYenJa(limit)}。他社で付与された分も通算されます）。`,
      };
    });
};
