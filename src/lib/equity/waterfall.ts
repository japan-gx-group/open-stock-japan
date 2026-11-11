// 残余財産の優先分配（みなし清算・M&A の対価の分配）の概算。サーバ依存なし。
//
// 種類株式の内容（share_classes）のうち、次の条件だけを使う:
//   seniority（大きいほど優先）/ originalIssuePrice × liquidationMultiple（優先分配額）/
//   participation（非参加・参加・上限つき参加）/ participationCapMultiple / conversionRatio
// 実際の分配は定款・株主間契約（みなし清算条項、未払配当、ドラッグアロングの条件など）で決まる。
// ここで出す数字は交渉・説明のための試算であり、契約書の文言が常に優先する。

import type { ShareClass } from './types';

export interface WaterfallHolding {
  shareClassId: string;
  shares: number;
}

export interface WaterfallClassResult {
  shareClassId: string;
  name: string;
  shares: number;
  /** 優先分配として受け取る額 */
  preference: number;
  /** 残余の分配（参加・普通株への転換後）として受け取る額 */
  participation: number;
  total: number;
  perShare: number;
  /** 非参加型が普通株へ転換して分配を受けたか */
  converted: boolean;
}

export interface WaterfallResult {
  exitValue: number;
  classes: WaterfallClassResult[];
  /** 丸めで配り切れなかった額 */
  undistributed: number;
}

interface Working {
  shareClass: ShareClass;
  shares: number;
  preferenceClaim: number;
  preference: number;
  participation: number;
  converted: boolean;
  capped: boolean;
}

const isPreferred = (shareClass: ShareClass): boolean =>
  shareClass.kind !== 'common' && (shareClass.originalIssuePrice ?? 0) > 0 && shareClass.liquidationMultiple > 0;

const distribute = (exitValue: number, working: Working[]): void => {
  for (const item of working) {
    item.preference = 0;
    item.participation = 0;
  }
  let remaining = exitValue;

  // 1) 優先分配: seniority の高い順。同順位は請求額の比で按分。
  const claimants = working.filter((item) => item.preferenceClaim > 0 && !item.converted);
  const levels = Array.from(new Set(claimants.map((item) => item.shareClass.seniority))).sort((a, b) => b - a);
  for (const level of levels) {
    const group = claimants.filter((item) => item.shareClass.seniority === level);
    const claim = group.reduce((total, item) => total + item.preferenceClaim, 0);
    const paid = Math.min(remaining, claim);
    for (const item of group) item.preference = claim > 0 ? (paid * item.preferenceClaim) / claim : 0;
    remaining -= paid;
    if (remaining <= 0) return;
  }

  // 2) 残余: 普通株・転換した非参加型・参加型が、普通株換算の株式数の比で分ける。
  //    上限つき参加型が上限に達したら上限で止め、残りを他で分け直す。
  for (let guard = 0; guard < working.length + 1; guard += 1) {
    const participants = working.filter((item) => {
      if (item.capped) return false;
      if (!isPreferred(item.shareClass)) return true;
      if (item.converted) return true;
      return item.shareClass.participation !== 'non_participating';
    });
    const cappedPaid = working.filter((item) => item.capped).reduce((total, item) => total + item.participation, 0);
    const pool = remaining - cappedPaid;
    const units = participants.reduce((total, item) => total + item.shares * item.shareClass.conversionRatio, 0);
    if (units <= 0 || pool <= 0) {
      for (const item of participants) item.participation = 0;
      return;
    }
    let newlyCapped = false;
    for (const item of participants) {
      item.participation = (pool * item.shares * item.shareClass.conversionRatio) / units;
      const capMultiple = item.shareClass.participationCapMultiple;
      if (
        item.shareClass.participation === 'capped_participating' &&
        !item.converted &&
        capMultiple != null &&
        isPreferred(item.shareClass)
      ) {
        const cap = Math.max(0, capMultiple * (item.shareClass.originalIssuePrice ?? 0) * item.shares - item.preference);
        if (item.participation > cap) {
          item.participation = cap;
          item.capped = true;
          newlyCapped = true;
        }
      }
    }
    if (!newlyCapped) return;
  }
};

/**
 * exitValue（株主に分配される総額。円）を種類ごとに配る。
 * 非参加型、および上限つき参加型は「優先分配を受ける」より「普通株に転換する」ほうが得なら転換する。
 */
export const computeWaterfall = (
  exitValue: number,
  shareClasses: readonly ShareClass[],
  holdings: readonly WaterfallHolding[],
): WaterfallResult => {
  const sharesByClass = new Map<string, number>();
  for (const holding of holdings) {
    sharesByClass.set(holding.shareClassId, (sharesByClass.get(holding.shareClassId) ?? 0) + holding.shares);
  }
  const working: Working[] = shareClasses
    .map((shareClass) => {
      const shares = sharesByClass.get(shareClass.id) ?? 0;
      return {
        shareClass,
        shares,
        preferenceClaim: isPreferred(shareClass)
          ? shareClass.liquidationMultiple * (shareClass.originalIssuePrice ?? 0) * shares
          : 0,
        preference: 0,
        participation: 0,
        converted: false,
        capped: false,
      };
    })
    .filter((item) => item.shares > 0);

  const value = Math.max(0, exitValue);
  // 転換の判断: まず誰も転換しない前提で配り、「転換したほうが多い」種類を 1 つずつ転換させて配り直す。
  // 転換する種類が増えるほど他の種類の転換の得は減るので、得が最も大きいものから順に確かめる。
  for (let guard = 0; guard <= working.length; guard += 1) {
    for (const item of working) item.capped = false;
    distribute(value, working);
    let best: { item: Working; gain: number } | null = null;
    for (const item of working) {
      if (item.converted || !isPreferred(item.shareClass)) continue;
      if (item.shareClass.participation === 'participating') continue;
      const current = item.preference + item.participation;
      item.converted = true;
      for (const other of working) other.capped = false;
      distribute(value, working);
      const asConverted = item.preference + item.participation;
      item.converted = false;
      if (asConverted > current + 0.5 && (!best || asConverted - current > best.gain)) {
        best = { item, gain: asConverted - current };
      }
    }
    if (!best) break;
    best.item.converted = true;
  }
  for (const item of working) item.capped = false;
  distribute(value, working);

  const classes: WaterfallClassResult[] = working
    .sort(
      (a, b) =>
        b.shareClass.seniority - a.shareClass.seniority || a.shareClass.sortOrder - b.shareClass.sortOrder,
    )
    .map((item) => {
      const preference = Math.floor(item.preference);
      const participation = Math.floor(item.participation);
      const total = preference + participation;
      return {
        shareClassId: item.shareClass.id,
        name: item.shareClass.name,
        shares: item.shares,
        preference,
        participation,
        total,
        perShare: item.shares > 0 ? total / item.shares : 0,
        converted: item.converted,
      };
    });

  return {
    exitValue: value,
    classes,
    undistributed: Math.max(0, value - classes.reduce((total, item) => total + item.total, 0)),
  };
};
