// 資本政策表の画面と Excel 出力のための、表示用の組み立て。計算そのものは src/lib/equity にあり、ここでは並べ方だけを決める。

import type { CapTable, CapTableRow, CapTableRowKind, ShareClassTotal } from '@/lib/equity/capTable';
import { optionLabel, STAKEHOLDER_KINDS } from '@/lib/equity/types';
import type { WaterfallHolding } from '@/lib/equity/waterfall';
import type { SheetCell, SheetColumn, SheetSpec } from './xlsx';

export const rowKindLabel = (kind: CapTableRowKind): string => {
  if (kind === 'new_investor') return '新規投資家';
  if (kind === 'pool') return '未割当枠';
  return optionLabel(STAKEHOLDER_KINDS, kind);
};

/** 発行済みの株式がある種類だけ（表の列にする） */
export const issuedClasses = (table: CapTable): ShareClassTotal[] =>
  table.classes.filter((shareClass) => shareClass.issuedShares !== 0);

export interface CapTableSheetContext {
  companyName: string;
  /** 「2026年11月11日 現在」「すべての異動を反映」など */
  asOfLabel: string;
  /** 表題（既定: 資本政策表） */
  title?: string;
}

/** 画面の表と同じ並びの Excel 用の表 */
export const capTableSheet = (table: CapTable, context: CapTableSheetContext): SheetSpec => {
  const classes = issuedClasses(table);
  const hasNewShares = table.totals.newShares > 0;
  const columns: SheetColumn[] = [
    { header: '株主・権利者', width: 32 },
    { header: '区分', width: 16 },
    ...classes.map((shareClass): SheetColumn => ({ header: `${shareClass.name}（株）`, format: 'integer' })),
    { header: '発行済合計（株）', format: 'integer' },
    { header: '持株比率', format: 'percent' },
    { header: '議決権比率', format: 'percent' },
    { header: '新株予約権（株）', format: 'integer' },
    { header: '転換型の投資額（円）', format: 'yen', width: 18 },
    { header: '転換型（株・概算）', format: 'integer', width: 16 },
    ...(hasNewShares ? [{ header: '新規引受（株）', format: 'integer' } satisfies SheetColumn] : []),
    { header: '完全希釈化後（株）', format: 'integer', width: 16 },
    { header: '完全希釈化後比率', format: 'percent', width: 16 },
  ];

  const cellsOf = (row: CapTableRow): SheetCell[] => [
    row.name,
    rowKindLabel(row.kind),
    ...classes.map((shareClass) => row.sharesByClass[shareClass.shareClassId] ?? 0),
    row.issuedShares,
    row.issuedRatio,
    row.votingRatio,
    row.optionShares,
    row.convertibleAmount,
    row.convertibleShares,
    ...(hasNewShares ? [row.newShares] : []),
    row.fullyDilutedShares,
    row.fullyDilutedRatio,
  ];

  const { totals } = table;
  const poolShown = table.rows.some((row) => row.kind === 'pool');
  const footer: SheetCell[] = [
    '合計',
    '',
    ...classes.map((shareClass) => shareClass.issuedShares),
    totals.issuedShares,
    totals.issuedShares > 0 ? 1 : 0,
    totals.votingShares > 0 ? 1 : 0,
    totals.optionShares + (poolShown ? totals.unallocatedPoolShares : 0),
    totals.convertibleAmount,
    totals.convertibleShares,
    ...(hasNewShares ? [totals.newShares] : []),
    totals.fullyDilutedShares,
    totals.fullyDilutedShares > 0 ? 1 : 0,
  ];

  return {
    sheetName: context.title ?? '資本政策表',
    titleLines: [context.title ?? '資本政策表', context.companyName, context.asOfLabel].filter((line) => line !== ''),
    columns,
    rows: table.rows.map(cellsOf),
    footer,
    notes: [
      '転換型（J-KISS 等）の株式数は概算です。実際の転換価額・株式数は契約書の定義によります。',
      '議決権比率は 1 株 1 議決権として計算しています（単元株・自己株式・相互保有株式は考慮していません）。',
    ],
  };
};

export interface DilutionRow {
  stakeholderId: string;
  name: string;
  kind: CapTableRowKind;
  beforeShares: number;
  afterShares: number;
  beforeRatio: number;
  afterRatio: number;
  /** 完全希釈化後比率の変化（ポイントではなく率の差。-0.05 は 5 ポイントの低下） */
  change: number;
}

/** 次回調達の前後で、完全希釈化後の比率がどう変わるか（並びは調達後の表に合わせる） */
export const dilutionRows = (before: CapTable, after: CapTable): DilutionRow[] => {
  const beforeById = new Map(before.rows.map((row) => [row.stakeholderId, row]));
  return after.rows.map((row) => {
    const previous = beforeById.get(row.stakeholderId);
    const beforeRatio = previous?.fullyDilutedRatio ?? 0;
    return {
      stakeholderId: row.stakeholderId,
      name: row.name,
      kind: row.kind,
      beforeShares: previous?.fullyDilutedShares ?? 0,
      afterShares: row.fullyDilutedShares,
      beforeRatio,
      afterRatio: row.fullyDilutedRatio,
      change: row.fullyDilutedRatio - beforeRatio,
    };
  });
};

/** 優先分配の試算に渡す、種類ごとの発行済株式数 */
export const waterfallHoldings = (table: CapTable): WaterfallHolding[] =>
  issuedClasses(table)
    .filter((shareClass) => shareClass.issuedShares > 0)
    .map((shareClass) => ({ shareClassId: shareClass.shareClassId, shares: shareClass.issuedShares }));

/** 売却額の前後を見比べるための系列（入力額の 1/4・1/2・1 倍・2 倍・4 倍） */
export const exitValueSeries = (exitValue: number): number[] =>
  exitValue > 0 ? [0.25, 0.5, 1, 2, 4].map((multiple) => Math.round(exitValue * multiple)) : [];

/** グラフの軸に使う短い金額表記（1.5億・5,000万・1,234） */
export const compactYen = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${Number((value / 100_000_000).toFixed(2)).toLocaleString('ja-JP')}億`;
  if (abs >= 10_000) return `${Number((value / 10_000).toFixed(1)).toLocaleString('ja-JP')}万`;
  return Math.round(value).toLocaleString('ja-JP');
};
