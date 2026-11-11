import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@/lib/equity/ledger';
import { COMMON, sampleSnapshot, transaction } from '@/lib/equity/__tests__/fixture';
import {
  filterStakeholders,
  holdingOn,
  registrySheet,
  splitPreview,
  summarizeStakeholders,
  transactionAmount,
  transactionViews,
} from '../ledgerViews';

const withTransfer = () => {
  const snapshot = sampleSnapshot();
  snapshot.shareTransactions.push(
    transaction('yamada', COMMON, '2025-06-01', -500, { transactionType: 'transfer', groupId: 'group-1', pricePerShare: 1_000 }),
    transaction('sato', COMMON, '2025-06-01', 500, { transactionType: 'transfer', groupId: 'group-1', pricePerShare: 1_000 }),
  );
  return snapshot;
};

describe('summarizeStakeholders / filterStakeholders', () => {
  it('権利者ごとに持株・新株予約権・転換型を集計する', () => {
    const summaries = summarizeStakeholders(sampleSnapshot());
    const byId = new Map(summaries.map((summary) => [summary.stakeholder.id, summary]));
    expect(summaries).toHaveLength(5);
    expect(byId.get('yamada')).toMatchObject({ issuedShares: 8000, optionShares: 0, convertibleAmount: 0 });
    expect(byId.get('suzuki')).toMatchObject({ issuedShares: 0, optionShares: 400 });
    expect(byId.get('aozora')).toMatchObject({ issuedShares: 0, convertibleAmount: 30_000_000 });
  });

  it('氏名・区分で絞り込める（全角半角・空白の違いは無視する）', () => {
    const summaries = summarizeStakeholders(sampleSnapshot());
    expect(filterStakeholders(summaries, '山田太郎').map((item) => item.stakeholder.id)).toEqual(['yamada']);
    expect(filterStakeholders(summaries, 'ファンド').map((item) => item.stakeholder.id)).toEqual(['aozora']);
    expect(filterStakeholders(summaries, '従業員').map((item) => item.stakeholder.id)).toEqual(['suzuki', 'tanaka']);
    expect(filterStakeholders(summaries, '  ')).toHaveLength(5);
  });
});

describe('transactionViews', () => {
  it('日付順に並べ、譲渡は減少 → 増加の順にして名前を付ける', () => {
    const views = transactionViews(withTransfer());
    expect(views.map((view) => view.transaction.transactionDate)).toEqual(['2024-04-01', '2024-04-01', '2025-06-01', '2025-06-01']);
    expect(views[2]).toMatchObject({ stakeholderName: '山田 太郎', typeLabel: '株式譲渡', isGrouped: true, amount: 500_000 });
    expect(views[2].transaction.shares).toBe(-500);
    expect(views[3].transaction.shares).toBe(500);
    expect(views[0]).toMatchObject({ shareClassName: '普通株式', isGrouped: false, roundName: '' });
  });

  it('金額は入力値を優先し、無ければ単価 × 株式数', () => {
    expect(transactionAmount({ amount: 123, pricePerShare: 10, shares: 5 })).toBe(123);
    expect(transactionAmount({ amount: null, pricePerShare: 10, shares: -5 })).toBe(50);
    expect(transactionAmount({ amount: null, pricePerShare: null, shares: 5 })).toBeNull();
  });
});

describe('holdingOn', () => {
  it('指定日時点の持株を返す', () => {
    const snapshot = withTransfer();
    expect(holdingOn(snapshot, 'yamada', COMMON, '2025-05-31')).toBe(8000);
    expect(holdingOn(snapshot, 'yamada', COMMON, '2025-06-01')).toBe(7500);
    expect(holdingOn(snapshot, 'yamada', COMMON, '2024-03-31')).toBe(0);
    expect(holdingOn(snapshot, 'suzuki', COMMON, null)).toBe(0);
  });
});

describe('splitPreview', () => {
  it('分割後の株式数と合計を返す', () => {
    const preview = splitPreview(sampleSnapshot(), COMMON, 100, '2026-01-01');
    expect(preview.rows.map((row) => [row.name, row.before, row.after])).toEqual([
      ['山田 太郎', 8000, 800_000],
      ['佐藤 花子', 2000, 200_000],
    ]);
    expect(preview).toMatchObject({ totalBefore: 10_000, totalAfter: 1_000_000, hasLaterTransactions: false });
  });

  it('効力発生日より後の異動があれば知らせる', () => {
    expect(splitPreview(withTransfer(), COMMON, 2, '2025-01-01').hasLaterTransactions).toBe(true);
  });
});

describe('registrySheet', () => {
  it('121条の記載事項の列と合計を作る', () => {
    const registry = buildRegistry(sampleSnapshot());
    const sheet = registrySheet(registry, '株式会社サンプル', '2026-11-11');
    expect(sheet.titleLines[0]).toBe('株主名簿（2026-11-11 現在）');
    expect(sheet.titleLines[1]).toBe('株式会社サンプル');
    expect(sheet.columns.map((column) => column.header).slice(0, 6)).toEqual(['氏名又は名称', 'フリガナ', '郵便番号', '住所', '株式の種類', '株式数']);
    for (const row of sheet.rows) expect(row).toHaveLength(sheet.columns.length);
    expect(sheet.footer).toHaveLength(sheet.columns.length);
    expect(sheet.rows[0].slice(0, 7)).toEqual(['山田 太郎', '', '', '東京都千代田区架空町1-1-1', '普通株式', 8000, '2024年4月1日']);
    expect(sheet.footer?.[5]).toBe(10_000);
  });
});
