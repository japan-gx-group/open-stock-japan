// 株式の異動台帳から、株主名簿（会社法121条）と台帳の整合チェックを作る。サーバ依存なし。

import type { EquitySnapshot, ShareTransaction, Stakeholder } from './types';

/** 株主名簿の 1 行（株主 × 株式の種類）。会社法121条の記載事項に対応する。 */
export interface RegistryRow {
  stakeholderId: string;
  /** 121条1号: 株主の氏名又は名称及び住所 */
  name: string;
  nameKana: string | null;
  postalCode: string | null;
  address: string;
  kind: Stakeholder['kind'];
  shareClassId: string;
  /** 121条2号: 株主の有する株式の数（種類株式発行会社では種類及び種類ごとの数） */
  shareClassName: string;
  shares: number;
  /** 121条3号: 株式を取得した日（現在の持株につながる取得のうち最初と最後） */
  firstAcquiredOn: string | null;
  lastAcquiredOn: string | null;
  /** その種類の発行済株式に対する割合 */
  classRatio: number;
  /** 発行済株式総数に対する割合 */
  totalRatio: number;
}

export interface Registry {
  asOf: string | null;
  rows: RegistryRow[];
  totalShares: number;
  shareholderCount: number;
}

const byDate = (a: ShareTransaction, b: ShareTransaction): number =>
  a.transactionDate.localeCompare(b.transactionDate) || (a.shares > 0 ? 1 : -1) - (b.shares > 0 ? 1 : -1);

/** 基準日（asOf）時点の株主名簿。asOf を省略するとすべての異動を反映する。 */
export const buildRegistry = (snapshot: EquitySnapshot, asOf: string | null = null): Registry => {
  const stakeholderById = new Map(snapshot.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder]));
  const classById = new Map(snapshot.shareClasses.map((shareClass) => [shareClass.id, shareClass]));
  const cells = new Map<string, { stakeholderId: string; shareClassId: string; shares: number; first: string | null; last: string | null }>();

  for (const transaction of [...snapshot.shareTransactions].sort(byDate)) {
    if (asOf != null && transaction.transactionDate > asOf) continue;
    const key = `${transaction.stakeholderId}:${transaction.shareClassId}`;
    const cell = cells.get(key) ?? {
      stakeholderId: transaction.stakeholderId,
      shareClassId: transaction.shareClassId,
      shares: 0,
      first: null,
      last: null,
    };
    cell.shares += transaction.shares;
    if (transaction.shares > 0) {
      cell.first ??= transaction.transactionDate;
      cell.last = transaction.transactionDate;
    }
    // 持株が 0 に戻ったら取得日もリセットする（その後に再取得した日が取得日になる）
    if (cell.shares <= 0) {
      cell.first = null;
      cell.last = null;
    }
    cells.set(key, cell);
  }

  const held = Array.from(cells.values()).filter((cell) => cell.shares > 0);
  const totalShares = held.reduce((total, cell) => total + cell.shares, 0);
  const classTotals = new Map<string, number>();
  for (const cell of held) classTotals.set(cell.shareClassId, (classTotals.get(cell.shareClassId) ?? 0) + cell.shares);

  const rows: RegistryRow[] = held.map((cell) => {
    const stakeholder = stakeholderById.get(cell.stakeholderId);
    const shareClass = classById.get(cell.shareClassId);
    return {
      stakeholderId: cell.stakeholderId,
      name: stakeholder?.name ?? '（不明な株主）',
      nameKana: stakeholder?.nameKana ?? null,
      postalCode: stakeholder?.postalCode ?? null,
      address: stakeholder?.address ?? '',
      kind: stakeholder?.kind ?? 'other',
      shareClassId: cell.shareClassId,
      shareClassName: shareClass?.name ?? '（不明な種類）',
      shares: cell.shares,
      firstAcquiredOn: cell.first,
      lastAcquiredOn: cell.last,
      classRatio: cell.shares / (classTotals.get(cell.shareClassId) ?? cell.shares),
      totalRatio: totalShares > 0 ? cell.shares / totalShares : 0,
    };
  });

  const sortOrder = (shareClassId: string): number => classById.get(shareClassId)?.sortOrder ?? 0;
  const holderTotal = new Map<string, number>();
  for (const row of rows) holderTotal.set(row.stakeholderId, (holderTotal.get(row.stakeholderId) ?? 0) + row.shares);
  rows.sort(
    (a, b) =>
      (holderTotal.get(b.stakeholderId) ?? 0) - (holderTotal.get(a.stakeholderId) ?? 0) ||
      a.name.localeCompare(b.name, 'ja') ||
      sortOrder(a.shareClassId) - sortOrder(b.shareClassId),
  );

  return { asOf, rows, totalShares, shareholderCount: holderTotal.size };
};

export type LedgerIssueLevel = 'error' | 'warning';

export interface LedgerIssue {
  level: LedgerIssueLevel;
  code:
    | 'negative_balance'
    | 'transfer_unbalanced'
    | 'missing_address'
    | 'exceeds_authorized'
    | 'exceeds_class_authorized'
    | 'option_pool_overallocated';
  message: string;
  stakeholderId?: string;
  shareClassId?: string;
}

export interface LedgerCheckContext {
  /** 発行可能株式総数（会社法113条）。未設定は null */
  authorizedShares: number | null;
}

/** 台帳の整合チェック。保存は止めず、画面に注意として出す。 */
export const checkLedger = (snapshot: EquitySnapshot, context: LedgerCheckContext): LedgerIssue[] => {
  const issues: LedgerIssue[] = [];
  const stakeholderById = new Map(snapshot.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder]));
  const classById = new Map(snapshot.shareClasses.map((shareClass) => [shareClass.id, shareClass]));

  // 1) どの時点でも持株がマイナスにならないこと（持っていない株式の譲渡）
  const balances = new Map<string, number>();
  const reported = new Set<string>();
  for (const transaction of [...snapshot.shareTransactions].sort(byDate)) {
    const key = `${transaction.stakeholderId}:${transaction.shareClassId}`;
    const balance = (balances.get(key) ?? 0) + transaction.shares;
    balances.set(key, balance);
    if (balance < 0 && !reported.has(key)) {
      reported.add(key);
      issues.push({
        level: 'error',
        code: 'negative_balance',
        stakeholderId: transaction.stakeholderId,
        shareClassId: transaction.shareClassId,
        message: `${stakeholderById.get(transaction.stakeholderId)?.name ?? '不明な株主'} の ${
          classById.get(transaction.shareClassId)?.name ?? '株式'
        } が ${transaction.transactionDate} 時点でマイナス（${balance.toLocaleString('ja-JP')}株）になります。異動の日付と株式数を確認してください。`,
      });
    }
  }

  // 2) 譲渡は譲渡人と譲受人の増減が打ち消し合うこと
  const groups = new Map<string, number>();
  for (const transaction of snapshot.shareTransactions) {
    if (transaction.transactionType !== 'transfer' || !transaction.groupId) continue;
    groups.set(transaction.groupId, (groups.get(transaction.groupId) ?? 0) + transaction.shares);
  }
  const unbalanced = Array.from(groups.values()).filter((net) => net !== 0).length;
  const ungrouped = snapshot.shareTransactions.filter(
    (transaction) => transaction.transactionType === 'transfer' && !transaction.groupId,
  );
  const ungroupedNet = ungrouped.reduce((total, transaction) => total + transaction.shares, 0);
  if (unbalanced > 0 || ungroupedNet !== 0) {
    issues.push({
      level: 'warning',
      code: 'transfer_unbalanced',
      message: '株式譲渡の記録に、譲渡人の減少と譲受人の増加が一致しないものがあります。発行済株式総数が登記と合っているか確認してください。',
    });
  }

  // 3) 株主名簿の記載事項（住所）が空の株主
  const holders = new Set<string>();
  for (const [key, balance] of balances) if (balance > 0) holders.add(key.split(':')[0]);
  for (const stakeholderId of holders) {
    const stakeholder = stakeholderById.get(stakeholderId);
    if (stakeholder && !stakeholder.address.trim()) {
      issues.push({
        level: 'warning',
        code: 'missing_address',
        stakeholderId,
        message: `${stakeholder.name} の住所が未入力です。住所は株主名簿の記載事項です（会社法121条1号）。`,
      });
    }
  }

  // 4) 発行可能株式総数・発行可能種類株式総数
  const issuedByClass = new Map<string, number>();
  for (const [key, balance] of balances) {
    const shareClassId = key.split(':')[1];
    issuedByClass.set(shareClassId, (issuedByClass.get(shareClassId) ?? 0) + balance);
  }
  const issued = Array.from(issuedByClass.values()).reduce((total, value) => total + value, 0);
  if (context.authorizedShares != null && issued > context.authorizedShares) {
    issues.push({
      level: 'error',
      code: 'exceeds_authorized',
      message: `発行済株式総数（${issued.toLocaleString('ja-JP')}株）が発行可能株式総数（${context.authorizedShares.toLocaleString(
        'ja-JP',
      )}株）を超えています。定款変更（株主総会の特別決議）と登記が必要です。`,
    });
  }
  for (const [shareClassId, shares] of issuedByClass) {
    const shareClass = classById.get(shareClassId);
    if (shareClass?.authorizedShares != null && shares > shareClass.authorizedShares) {
      issues.push({
        level: 'error',
        code: 'exceeds_class_authorized',
        shareClassId,
        message: `${shareClass.name} の発行済株式数（${shares.toLocaleString('ja-JP')}株）が発行可能種類株式総数（${shareClass.authorizedShares.toLocaleString(
          'ja-JP',
        )}株）を超えています。`,
      });
    }
  }

  // 5) 新株予約権の割当個数が発行総数を超えていないこと
  const grantedByPlan = new Map<string, number>();
  for (const grant of snapshot.optionGrants) {
    grantedByPlan.set(grant.planId, (grantedByPlan.get(grant.planId) ?? 0) + grant.units);
  }
  for (const plan of snapshot.optionPlans) {
    const granted = grantedByPlan.get(plan.id) ?? 0;
    if (granted > plan.totalUnits) {
      issues.push({
        level: 'error',
        code: 'option_pool_overallocated',
        message: `${plan.name} の割当個数の合計（${granted.toLocaleString('ja-JP')}個）が発行総数（${plan.totalUnits.toLocaleString(
          'ja-JP',
        )}個）を超えています。`,
      });
    }
  }

  return issues;
};

/** 株式分割（1 株 → ratio 株）で各株主に増える株式数。併合（ratio < 1）は減る数（負）を返す。端数は切り捨て。 */
export const splitAdjustments = (
  snapshot: EquitySnapshot,
  shareClassId: string,
  ratio: number,
  asOf: string,
): { stakeholderId: string; before: number; after: number; delta: number }[] => {
  const balances = new Map<string, number>();
  for (const transaction of snapshot.shareTransactions) {
    if (transaction.shareClassId !== shareClassId || transaction.transactionDate > asOf) continue;
    balances.set(transaction.stakeholderId, (balances.get(transaction.stakeholderId) ?? 0) + transaction.shares);
  }
  return Array.from(balances.entries())
    .filter(([, shares]) => shares > 0)
    .map(([stakeholderId, before]) => {
      const after = Math.floor(before * ratio + 1e-9);
      return { stakeholderId, before, after, delta: after - before };
    })
    .filter((row) => row.delta !== 0);
};
