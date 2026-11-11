// 資本政策表（cap table）の計算。台帳一式（EquitySnapshot）から、名義人ごとの持株・潜在株式・希薄化後の比率を求める。
//
// 数え方:
//   - 発行済株式数: 株式の異動（share_transactions）の合計。基準日（asOf）を渡すとその日までの異動だけを数える。
//   - 普通株換算: 種類株式は 株式数 × 転換比率（share_classes.conversionRatio）で普通株に直して比率を出す。
//   - 新株予約権: 残数（割当 − 行使 − 失効）× 1 個あたりの株式数。未割当の枠は options.includeUnallocatedPool で含める。
//   - 転換型（J-KISS 等）: 未転換の投資額 ÷ 転換価額（株未満切り捨て）。
//       転換価額 = min(評価上限額 ÷ 完全希釈化後株式数, 次回調達の 1 株あたり払込金額 × (1 − ディスカウント))（円未満切り上げ）
//       完全希釈化後株式数 = 普通株換算の発行済株式数 ＋ 未行使の新株予約権。
//       評価上限額の基準がプレマネー（J-KISS 1.x）なら転換型自身は含めず、ポストマネー（J-KISS 2.0）なら
//       転換型の転換後の株式も含める（convertible_rounds.capBasis）。
//       ※ 契約書の「完全希釈化後株式数」の定義（未割当の枠を含むか等）は案件ごとに違うため、
//         options.conversionBaseIncludesPool で切り替えられるようにしてある。実際の転換は契約書で確認すること。
//   - すべての回次が同時に転換する前提で、どの回次も同じ株式数を基準にする。

import { ceilYen } from './format';
import {
  CAPITAL_TRANSACTION_TYPES,
  type CapBasis,
  type EquitySnapshot,
  type OptionEvent,
  type OptionGrant,
  type ShareClass,
  type StakeholderKind,
} from './types';

/** 次回の資金調達を仮定するときの条件 */
export interface RoundScenario {
  /** 次回調達の 1 株あたり払込金額（円）。null ならキャップ基準の転換だけを見る */
  pricePerShare: number | null;
  /** 次回調達で新しく入る金額（円）。0 なら新規投資家の行は出さない */
  newMoney: number;
  newInvestorName: string;
  /** 次回調達に合わせて追加するストックオプション枠（株）。未割当の枠として希薄化に含める */
  additionalPoolShares: number;
}

export interface CapTableOptions {
  /** この日までの異動で集計する（YYYY-MM-DD）。省略時はすべて */
  asOf?: string | null;
  scenario?: RoundScenario | null;
  /** 未割当のストックオプション枠を完全希釈化後株式数に含める（既定: 含める） */
  includeUnallocatedPool?: boolean;
  /** 転換価額の計算の基準に未割当の枠を含める（既定: 含めない） */
  conversionBaseIncludesPool?: boolean;
}

export interface ConversionInvestmentDetail {
  investmentId: string;
  stakeholderId: string;
  stakeholderName: string;
  amount: number;
  shares: number;
}

export interface ConversionDetail {
  roundId: string;
  roundName: string;
  valuationCap: number | null;
  capBasis: CapBasis;
  discountRate: number;
  /** 評価上限額 ÷ 完全希釈化後株式数（円未満切り上げ）。キャップなしは null */
  capPrice: number | null;
  /** 次回調達の単価 × (1 − ディスカウント)。シナリオなしは null */
  discountPrice: number | null;
  /** 0 は「転換価額を決められない」（キャップなし かつ シナリオなし） */
  conversionPrice: number;
  basis: 'cap' | 'discount' | 'undetermined';
  totalAmount: number;
  totalShares: number;
  investments: ConversionInvestmentDetail[];
}

export type CapTableRowKind = StakeholderKind | 'new_investor' | 'pool';

export interface CapTableRow {
  stakeholderId: string;
  name: string;
  kind: CapTableRowKind;
  /** 種類ごとの発行済株式数（shareClassId → 株） */
  sharesByClass: Record<string, number>;
  /** 発行済株式数（種類を問わず単純合計） */
  issuedShares: number;
  /** 普通株換算の発行済株式数 */
  convertedShares: number;
  /** 議決権のある株式数（1 株 1 議決権として。単元株・自己株式・相互保有は考慮しない） */
  votingShares: number;
  issuedRatio: number;
  votingRatio: number;
  /** 株式として会社に払い込んだ金額の合計 */
  paidIn: number;
  /** 未行使の新株予約権を株式に換算した数 */
  optionShares: number;
  /** 未転換の転換型証券の投資額 */
  convertibleAmount: number;
  /** 転換したときに交付する株式数（概算） */
  convertibleShares: number;
  /** 次回調達で新しく引き受ける株式数（シナリオのみ） */
  newShares: number;
  fullyDilutedShares: number;
  fullyDilutedRatio: number;
}

export interface ShareClassTotal {
  shareClassId: string;
  name: string;
  issuedShares: number;
  convertedShares: number;
  holderCount: number;
}

export interface CapTableTotals {
  issuedShares: number;
  convertedShares: number;
  votingShares: number;
  paidIn: number;
  optionShares: number;
  optionUnitsGranted: number;
  optionUnitsRemaining: number;
  /** 未割当のストックオプション枠（株換算。シナリオの追加枠を含む） */
  unallocatedPoolShares: number;
  convertibleAmount: number;
  convertibleShares: number;
  newShares: number;
  fullyDilutedShares: number;
  /** 転換価額の計算に使った完全希釈化後株式数 */
  conversionBaseShares: number;
  shareholderCount: number;
}

export interface CapTable {
  asOf: string | null;
  rows: CapTableRow[];
  totals: CapTableTotals;
  classes: ShareClassTotal[];
  conversions: ConversionDetail[];
  scenario: RoundScenario | null;
}

export const NEW_INVESTOR_ROW_ID = 'new-investor';
export const POOL_ROW_ID = 'unallocated-pool';

const onOrBefore = (date: string | null | undefined, asOf: string | null): boolean =>
  asOf == null || date == null || date <= asOf;

const sum = <T>(items: Iterable<T>, pick: (item: T) => number): number => {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
};

/** 割当ごとの行使済み・失効の個数（基準日まで） */
export const grantEventTotals = (
  events: readonly OptionEvent[],
  asOf: string | null = null,
): Map<string, { exercised: number; forfeited: number }> => {
  const totals = new Map<string, { exercised: number; forfeited: number }>();
  for (const event of events) {
    if (!onOrBefore(event.eventDate, asOf)) continue;
    const entry = totals.get(event.grantId) ?? { exercised: 0, forfeited: 0 };
    if (event.eventType === 'exercise') entry.exercised += event.units;
    else entry.forfeited += event.units;
    totals.set(event.grantId, entry);
  }
  return totals;
};

/** 割当の残数（個） */
export const grantRemainingUnits = (
  grant: Pick<OptionGrant, 'id' | 'units'>,
  totals: Map<string, { exercised: number; forfeited: number }>,
): number => {
  const used = totals.get(grant.id);
  return Math.max(0, grant.units - (used?.exercised ?? 0) - (used?.forfeited ?? 0));
};

export const buildCapTable = (snapshot: EquitySnapshot, options: CapTableOptions = {}): CapTable => {
  const asOf = options.asOf ?? null;
  const scenario = options.scenario ?? null;
  const includePool = options.includeUnallocatedPool ?? true;

  const stakeholderById = new Map(snapshot.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder]));
  const classById = new Map<string, ShareClass>(snapshot.shareClasses.map((shareClass) => [shareClass.id, shareClass]));
  const rowById = new Map<string, CapTableRow>();

  const rowFor = (stakeholderId: string): CapTableRow => {
    let row = rowById.get(stakeholderId);
    if (!row) {
      const stakeholder = stakeholderById.get(stakeholderId);
      row = {
        stakeholderId,
        name: stakeholder?.name ?? '（不明な権利者）',
        kind: stakeholder?.kind ?? 'other',
        sharesByClass: {},
        issuedShares: 0,
        convertedShares: 0,
        votingShares: 0,
        issuedRatio: 0,
        votingRatio: 0,
        paidIn: 0,
        optionShares: 0,
        convertibleAmount: 0,
        convertibleShares: 0,
        newShares: 0,
        fullyDilutedShares: 0,
        fullyDilutedRatio: 0,
      };
      rowById.set(stakeholderId, row);
    }
    return row;
  };

  // 1) 発行済株式
  for (const transaction of snapshot.shareTransactions) {
    if (!onOrBefore(transaction.transactionDate, asOf)) continue;
    const row = rowFor(transaction.stakeholderId);
    row.sharesByClass[transaction.shareClassId] = (row.sharesByClass[transaction.shareClassId] ?? 0) + transaction.shares;
    if (CAPITAL_TRANSACTION_TYPES.includes(transaction.transactionType) && transaction.shares > 0) {
      row.paidIn += transaction.amount ?? 0;
    }
  }
  for (const row of rowById.values()) {
    for (const [shareClassId, shares] of Object.entries(row.sharesByClass)) {
      const shareClass = classById.get(shareClassId);
      row.issuedShares += shares;
      // 換算後の端数は名義人 × 種類ごとに切り捨てる（転換時の 1 株未満の端数は金銭で処理するのが通例）
      row.convertedShares += Math.floor(shares * (shareClass?.conversionRatio ?? 1) + 1e-9);
      if (shareClass?.hasVotingRights ?? true) row.votingShares += shares;
    }
  }

  // 2) 新株予約権
  const planById = new Map(snapshot.optionPlans.map((plan) => [plan.id, plan]));
  const eventTotals = grantEventTotals(snapshot.optionEvents, asOf);
  const grantedUnitsByPlan = new Map<string, number>();
  let optionUnitsGranted = 0;
  let optionUnitsRemaining = 0;
  for (const grant of snapshot.optionGrants) {
    const plan = planById.get(grant.planId);
    if (!plan || !onOrBefore(grant.grantedOn ?? plan.allotmentDate, asOf)) continue;
    const remaining = grantRemainingUnits(grant, eventTotals);
    optionUnitsGranted += grant.units;
    optionUnitsRemaining += remaining;
    // 失効した新株予約権は消滅し（会社法287条）、枠には戻らない。未割当 = 発行総数 − 割当個数の合計。
    grantedUnitsByPlan.set(plan.id, (grantedUnitsByPlan.get(plan.id) ?? 0) + grant.units);
    rowFor(grant.stakeholderId).optionShares += remaining * plan.sharesPerUnit;
  }
  let unallocatedPoolShares = 0;
  for (const plan of snapshot.optionPlans) {
    if (!onOrBefore(plan.allotmentDate ?? plan.resolutionDate, asOf)) continue;
    // 行使期間を過ぎた回次の枠は消滅しているので数えない
    if (asOf != null && plan.exercisePeriodEnd != null && plan.exercisePeriodEnd < asOf) continue;
    const unallocatedUnits = Math.max(0, plan.totalUnits - (grantedUnitsByPlan.get(plan.id) ?? 0));
    // 信託型は受益者確定まで信託が保有するため、未割当分も発行済みの潜在株式として数える
    unallocatedPoolShares += unallocatedUnits * plan.sharesPerUnit;
  }
  unallocatedPoolShares += Math.max(0, Math.floor(scenario?.additionalPoolShares ?? 0));

  const issuedShares = sum(rowById.values(), (row) => row.issuedShares);
  const convertedShares = sum(rowById.values(), (row) => row.convertedShares);
  const optionShares = sum(rowById.values(), (row) => row.optionShares);
  const conversionBaseShares =
    convertedShares + optionShares + (options.conversionBaseIncludesPool ? unallocatedPoolShares : 0);

  // 3) 転換型証券
  const conversions: ConversionDetail[] = [];
  const outstanding = [...snapshot.convertibleRounds]
    .sort((a, b) => a.roundNo - b.roundNo)
    .filter((round) => round.status === 'outstanding' && onOrBefore(round.issueDate, asOf))
    .map((round) => ({
      round,
      investments: snapshot.convertibleInvestments.filter(
        (investment) =>
          investment.roundId === round.id &&
          onOrBefore(investment.investmentDate, asOf) &&
          (investment.convertedShares == null ||
            (asOf != null && investment.convertedOn != null && investment.convertedOn > asOf)),
      ),
    }))
    .filter((entry) => entry.investments.length > 0);

  const priceOf = (round: (typeof outstanding)[number]['round'], assumedConversionShares: number) => {
    // ポストマネー基準のキャップは、転換型の転換後の株式も含めた株式数で割る
    const capBase = conversionBaseShares + (round.capBasis === 'post_money' ? assumedConversionShares : 0);
    const capPrice =
      round.valuationCap != null && capBase > 0 ? Math.max(1, ceilYen(round.valuationCap / capBase)) : null;
    const discountPrice =
      scenario?.pricePerShare != null && scenario.pricePerShare > 0
        ? Math.max(1, ceilYen(scenario.pricePerShare * (1 - round.discountRate)))
        : null;
    if (capPrice != null && (discountPrice == null || capPrice <= discountPrice)) {
      return { capPrice, discountPrice, conversionPrice: capPrice, basis: 'cap' as const };
    }
    if (discountPrice != null) return { capPrice, discountPrice, conversionPrice: discountPrice, basis: 'discount' as const };
    return { capPrice, discountPrice, conversionPrice: 0, basis: 'undetermined' as const };
  };
  const totalSharesAt = (assumed: number): number =>
    sum(outstanding, ({ round, investments }) => {
      const { conversionPrice } = priceOf(round, assumed);
      return conversionPrice > 0 ? sum(investments, (investment) => Math.floor(investment.amount / conversionPrice)) : 0;
    });
  // 転換株式が増えると転換価額が下がり、さらに転換株式が増える。変わらなくなるまで繰り返す。
  let assumedConversionShares = 0;
  for (let i = 0; i < 200; i += 1) {
    const next = totalSharesAt(assumedConversionShares);
    if (next === assumedConversionShares) break;
    assumedConversionShares = next;
  }

  for (const { round, investments } of outstanding) {
    const price = priceOf(round, assumedConversionShares);
    const detail: ConversionDetail = {
      roundId: round.id,
      roundName: round.name,
      valuationCap: round.valuationCap,
      capBasis: round.capBasis,
      discountRate: round.discountRate,
      ...price,
      totalAmount: 0,
      totalShares: 0,
      investments: [],
    };
    for (const investment of investments) {
      const shares = price.conversionPrice > 0 ? Math.floor(investment.amount / price.conversionPrice) : 0;
      const row = rowFor(investment.stakeholderId);
      row.convertibleAmount += investment.amount;
      row.convertibleShares += shares;
      detail.totalAmount += investment.amount;
      detail.totalShares += shares;
      detail.investments.push({
        investmentId: investment.id,
        stakeholderId: investment.stakeholderId,
        stakeholderName: row.name,
        amount: investment.amount,
        shares,
      });
    }
    conversions.push(detail);
  }

  // 4) 次回調達の新規引受
  let newShares = 0;
  if (scenario && scenario.pricePerShare != null && scenario.pricePerShare > 0 && scenario.newMoney > 0) {
    newShares = Math.floor(scenario.newMoney / scenario.pricePerShare);
    const row = rowFor(NEW_INVESTOR_ROW_ID);
    row.name = scenario.newInvestorName.trim() || '新規投資家（次回調達）';
    row.kind = 'new_investor';
    row.newShares = newShares;
  }

  // 5) 未割当の枠（表示用の行）
  if (includePool && unallocatedPoolShares > 0) {
    const row = rowFor(POOL_ROW_ID);
    row.name = 'ストックオプション未割当枠';
    row.kind = 'pool';
    row.optionShares = unallocatedPoolShares;
  }

  // 持株も潜在株式も無くなった名義人（全部譲渡した人など）は表に出さない
  const rows = Array.from(rowById.values()).filter(
    (row) =>
      row.issuedShares !== 0 || row.optionShares > 0 || row.convertibleAmount > 0 || row.newShares > 0,
  );
  const votingShares = sum(rows, (row) => row.votingShares);
  for (const row of rows) {
    row.fullyDilutedShares = row.convertedShares + row.optionShares + row.convertibleShares + row.newShares;
  }
  const fullyDilutedShares = sum(rows, (row) => row.fullyDilutedShares);
  for (const row of rows) {
    row.issuedRatio = issuedShares > 0 ? row.issuedShares / issuedShares : 0;
    row.votingRatio = votingShares > 0 ? row.votingShares / votingShares : 0;
    row.fullyDilutedRatio = fullyDilutedShares > 0 ? row.fullyDilutedShares / fullyDilutedShares : 0;
  }
  const rank = (row: CapTableRow): number => (row.kind === 'pool' ? 2 : row.kind === 'new_investor' ? 1 : 0);
  rows.sort(
    (a, b) => rank(a) - rank(b) || b.fullyDilutedShares - a.fullyDilutedShares || a.name.localeCompare(b.name, 'ja'),
  );

  const classes: ShareClassTotal[] = [...snapshot.shareClasses]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja'))
    .map((shareClass) => {
      const holders = rows.filter((row) => (row.sharesByClass[shareClass.id] ?? 0) > 0);
      const issued = sum(rows, (row) => row.sharesByClass[shareClass.id] ?? 0);
      return {
        shareClassId: shareClass.id,
        name: shareClass.name,
        issuedShares: issued,
        convertedShares: sum(rows, (row) =>
          Math.floor((row.sharesByClass[shareClass.id] ?? 0) * shareClass.conversionRatio + 1e-9),
        ),
        holderCount: holders.length,
      };
    });

  return {
    asOf,
    rows,
    totals: {
      issuedShares,
      convertedShares,
      votingShares,
      paidIn: sum(rows, (row) => row.paidIn),
      optionShares,
      optionUnitsGranted,
      optionUnitsRemaining,
      unallocatedPoolShares,
      convertibleAmount: sum(rows, (row) => row.convertibleAmount),
      convertibleShares: sum(rows, (row) => row.convertibleShares),
      newShares,
      fullyDilutedShares,
      conversionBaseShares,
      shareholderCount: rows.filter((row) => row.issuedShares > 0).length,
    },
    classes,
    conversions,
    scenario,
  };
};

export type PreMoneyBasis =
  /** プレマネー ÷（発行済 ＋ 新株予約権）。転換型の転換株式は含めない */
  | 'excluding_convertibles'
  /** プレマネー ÷（発行済 ＋ 新株予約権 ＋ 転換型の転換株式）。投資家の見るプレマネーに近い */
  | 'including_convertibles';

/**
 * プレマネー評価額から次回調達の 1 株あたり払込金額を求める（円未満切り上げ）。
 * including_convertibles では、単価が下がるほど転換株式が増えて単価がさらに下がるため、収束するまで繰り返す。
 */
export const pricePerShareFromPreMoney = (
  snapshot: EquitySnapshot,
  preMoney: number,
  basis: PreMoneyBasis = 'excluding_convertibles',
  options: Omit<CapTableOptions, 'scenario'> = {},
): number | null => {
  if (!(preMoney > 0)) return null;
  const base = buildCapTable(snapshot, { ...options, scenario: null });
  const poolShares = (options.includeUnallocatedPool ?? true) ? base.totals.unallocatedPoolShares : 0;
  const baseShares = base.totals.convertedShares + base.totals.optionShares + poolShares;
  if (baseShares <= 0) return null;
  let price = Math.max(1, ceilYen(preMoney / baseShares));
  if (basis === 'excluding_convertibles') return price;

  for (let i = 0; i < 50; i += 1) {
    const table = buildCapTable(snapshot, {
      ...options,
      scenario: { pricePerShare: price, newMoney: 0, newInvestorName: '', additionalPoolShares: 0 },
    });
    const next = Math.max(1, ceilYen(preMoney / (baseShares + table.totals.convertibleShares)));
    if (next === price) break;
    price = next;
  }
  return price;
};

/** 表の合計から見たポストマネー評価額（完全希釈化後株式数 × 単価） */
export const postMoneyValuation = (table: CapTable): number | null => {
  const price = table.scenario?.pricePerShare;
  return price != null && price > 0 ? table.totals.fullyDilutedShares * price : null;
};
