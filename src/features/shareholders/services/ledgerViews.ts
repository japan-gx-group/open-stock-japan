// 株主名簿の画面のための、表示用の組み立て（権利者ごとの集計・異動の一覧・譲渡と分割の確認・Excel 用の表）。
// 計算は src/lib/equity（buildCapTable / buildRegistry / splitAdjustments）を使い、ここでは並べ方だけを決める。

import type { SheetSpec } from '@/features/cap-table/services/xlsx';
import { buildCapTable } from '@/lib/equity/capTable';
import { formatDateJa } from '@/lib/equity/format';
import { buildRegistry, splitAdjustments, type Registry } from '@/lib/equity/ledger';
import {
  optionLabel,
  SHARE_TRANSACTION_TYPES,
  STAKEHOLDER_KINDS,
  STAKEHOLDER_RELATIONSHIPS,
  type EquitySnapshot,
  type ShareTransaction,
  type Stakeholder,
} from '@/lib/equity/types';

export interface StakeholderSummary {
  stakeholder: Stakeholder;
  issuedShares: number;
  /** 未行使の新株予約権（株換算） */
  optionShares: number;
  /** 未転換の転換型証券の投資額 */
  convertibleAmount: number;
}

/** 権利者ごとの持株・新株予約権・転換型の集計（持っていない人も 0 で返す） */
export const summarizeStakeholders = (snapshot: EquitySnapshot): StakeholderSummary[] => {
  const table = buildCapTable(snapshot, { includeUnallocatedPool: false });
  const rowById = new Map(table.rows.map((row) => [row.stakeholderId, row]));
  return snapshot.stakeholders.map((stakeholder) => {
    const row = rowById.get(stakeholder.id);
    return {
      stakeholder,
      issuedShares: row?.issuedShares ?? 0,
      optionShares: row?.optionShares ?? 0,
      convertibleAmount: row?.convertibleAmount ?? 0,
    };
  });
};

const normalize = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** 氏名・フリガナ・住所・連絡先・区分での絞り込み */
export const filterStakeholders = (summaries: StakeholderSummary[], query: string): StakeholderSummary[] => {
  const needle = normalize(query);
  if (!needle) return summaries;
  return summaries.filter(({ stakeholder }) =>
    [
      stakeholder.name,
      stakeholder.nameKana,
      stakeholder.address,
      stakeholder.email,
      stakeholder.phone,
      stakeholder.contactPerson,
      optionLabel(STAKEHOLDER_KINDS, stakeholder.kind),
      optionLabel(STAKEHOLDER_RELATIONSHIPS, stakeholder.relationship),
    ].some((value) => value != null && normalize(value).includes(needle)),
  );
};

export interface TransactionView {
  transaction: ShareTransaction;
  stakeholderName: string;
  shareClassName: string;
  roundName: string;
  typeLabel: string;
  /** 金額（未入力なら 1 株あたりの金額 × 株式数の絶対値） */
  amount: number | null;
  /** 譲渡・分割でまとめて作った行（編集できず、削除はまとめて行う） */
  isGrouped: boolean;
}

export const transactionAmount = (transaction: Pick<ShareTransaction, 'amount' | 'pricePerShare' | 'shares'>): number | null =>
  transaction.amount ?? (transaction.pricePerShare != null ? Math.round(transaction.pricePerShare * Math.abs(transaction.shares)) : null);

/** 株式の異動を日付順（同じ日は減少 → 増加）に並べ、名前を付ける */
export const transactionViews = (snapshot: EquitySnapshot): TransactionView[] => {
  const stakeholderById = new Map(snapshot.stakeholders.map((item) => [item.id, item.name]));
  const classById = new Map(snapshot.shareClasses.map((item) => [item.id, item.name]));
  const roundById = new Map(snapshot.fundingRounds.map((item) => [item.id, item.name]));
  return snapshot.shareTransactions
    .map((transaction, index) => ({ transaction, index }))
    .sort(
      (a, b) =>
        a.transaction.transactionDate.localeCompare(b.transaction.transactionDate) ||
        (a.transaction.groupId ?? '').localeCompare(b.transaction.groupId ?? '') ||
        a.transaction.shares - b.transaction.shares ||
        a.index - b.index,
    )
    .map(({ transaction }) => ({
      transaction,
      stakeholderName: stakeholderById.get(transaction.stakeholderId) ?? '（不明な株主）',
      shareClassName: classById.get(transaction.shareClassId) ?? '（不明な種類）',
      roundName: transaction.roundId ? (roundById.get(transaction.roundId) ?? '') : '',
      typeLabel: optionLabel(SHARE_TRANSACTION_TYPES, transaction.transactionType),
      amount: transactionAmount(transaction),
      isGrouped: transaction.groupId != null,
    }));
};

/** 指定日時点で、株主がその種類を何株持っているか */
export const holdingOn = (snapshot: EquitySnapshot, stakeholderId: string, shareClassId: string, date: string | null): number =>
  buildRegistry(snapshot, date).rows.find((row) => row.stakeholderId === stakeholderId && row.shareClassId === shareClassId)?.shares ?? 0;

export interface SplitPreviewRow {
  stakeholderId: string;
  name: string;
  before: number;
  after: number;
  delta: number;
}

export interface SplitPreview {
  rows: SplitPreviewRow[];
  totalBefore: number;
  totalAfter: number;
  /** 効力発生日より後の異動がある（サーバは記録を断る） */
  hasLaterTransactions: boolean;
}

/** 株式分割・併合で各株主の株式数がどう変わるか */
export const splitPreview = (snapshot: EquitySnapshot, shareClassId: string, ratio: number, date: string): SplitPreview => {
  const nameById = new Map(snapshot.stakeholders.map((item) => [item.id, item.name]));
  const rows = splitAdjustments(snapshot, shareClassId, ratio, date)
    .map((row) => ({ ...row, name: nameById.get(row.stakeholderId) ?? '（不明な株主）' }))
    .sort((a, b) => b.before - a.before || a.name.localeCompare(b.name, 'ja'));
  return {
    rows,
    totalBefore: rows.reduce((total, row) => total + row.before, 0),
    totalAfter: rows.reduce((total, row) => total + row.after, 0),
    hasLaterTransactions: snapshot.shareTransactions.some(
      (transaction) => transaction.shareClassId === shareClassId && transaction.transactionDate > date,
    ),
  };
};

/** 株主名簿の Excel 用の表。date は「いつ現在の名簿か」（基準日。未指定なら今日） */
export const registrySheet = (registry: Registry, companyName: string, date: string): SheetSpec => ({
  sheetName: '株主名簿',
  titleLines: [`株主名簿（${date} 現在）`, companyName, `発行済株式総数 ${registry.totalShares.toLocaleString('ja-JP')}株 ／ 株主数 ${registry.shareholderCount.toLocaleString('ja-JP')}名`].filter(
    (line) => line !== '',
  ),
  columns: [
    { header: '氏名又は名称', width: 32 },
    { header: 'フリガナ', width: 24 },
    { header: '郵便番号', width: 12 },
    { header: '住所', width: 44 },
    { header: '株式の種類', width: 18 },
    { header: '株式数', format: 'integer' },
    { header: '株式を取得した日（最初）', width: 20 },
    { header: '株式を取得した日（最後）', width: 20 },
    { header: '種類内の割合', format: 'percent' },
    { header: '発行済株式総数に対する割合', format: 'percent', width: 22 },
  ],
  rows: registry.rows.map((row) => [
    row.name,
    row.nameKana ?? '',
    row.postalCode ?? '',
    row.address,
    row.shareClassName,
    row.shares,
    row.firstAcquiredOn ? formatDateJa(row.firstAcquiredOn) : '',
    row.lastAcquiredOn ? formatDateJa(row.lastAcquiredOn) : '',
    row.classRatio,
    row.totalRatio,
  ]),
  footer: ['合計', '', '', '', '', registry.totalShares, '', '', null, registry.totalShares > 0 ? 1 : 0],
  notes: ['会社法121条の株主名簿記載事項（氏名又は名称及び住所・株式の種類及び数・株式を取得した日）を記載しています。'],
});
