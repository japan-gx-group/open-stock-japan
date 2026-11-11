import { describe, expect, it } from 'vitest';
import { buildCapTable } from '@/lib/equity/capTable';
import { sampleSnapshot } from '@/lib/equity/__tests__/fixture';
import { capTableSheet, compactYen, dilutionRows, exitValueSeries, issuedClasses, rowKindLabel, waterfallHoldings } from '../capTableGrid';
import { sheetToXlsxBlob } from '../xlsx';

describe('capTableSheet', () => {
  const table = buildCapTable(sampleSnapshot());
  const sheet = capTableSheet(table, { companyName: '架空株式会社', asOfLabel: 'すべての異動を反映' });

  it('列の数と各行のセルの数がそろう', () => {
    for (const row of sheet.rows) expect(row).toHaveLength(sheet.columns.length);
    expect(sheet.footer).toHaveLength(sheet.columns.length);
    expect(sheet.rows).toHaveLength(table.rows.length);
  });

  it('発行済みの種類だけを列にし、合計は表の合計と一致する', () => {
    const classes = issuedClasses(table);
    expect(classes.length).toBeGreaterThan(0);
    expect(sheet.columns.slice(2, 2 + classes.length).map((column) => column.header)).toEqual(
      classes.map((shareClass) => `${shareClass.name}（株）`),
    );
    const issuedIndex = 2 + classes.length;
    expect(sheet.footer?.[issuedIndex]).toBe(table.totals.issuedShares);
    expect(sheet.rows.reduce((total, row) => total + Number(row[issuedIndex]), 0)).toBe(table.totals.issuedShares);
    expect(sheet.footer?.at(-2)).toBe(table.totals.fullyDilutedShares);
    expect(sheet.rows.reduce((total, row) => total + Number(row.at(-2)), 0)).toBe(table.totals.fullyDilutedShares);
  });

  it('表題に会社名と基準日を入れる', () => {
    expect(sheet.titleLines).toEqual(['資本政策表', '架空株式会社', 'すべての異動を反映']);
  });

  it('シナリオで新規引受があるときだけ列を足す', () => {
    const simulated = buildCapTable(sampleSnapshot(), {
      scenario: { pricePerShare: 10_000, newMoney: 100_000_000, newInvestorName: '新ファンド', additionalPoolShares: 0 },
    });
    const simulatedSheet = capTableSheet(simulated, { companyName: '', asOfLabel: '' });
    expect(simulatedSheet.columns.map((column) => column.header)).toContain('新規引受（株）');
    expect(sheet.columns.map((column) => column.header)).not.toContain('新規引受（株）');
    expect(simulatedSheet.titleLines).toEqual(['資本政策表']);
  });

  it('xlsx として書き出して読み戻せる', async () => {
    const blob = await sheetToXlsxBlob(sheet);
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const worksheet = workbook.getWorksheet('資本政策表');
    expect(worksheet?.getCell('A1').value).toBe('資本政策表');
    // 表題 3 行 + 空行 + 見出し + 明細 + 合計
    const footerRow = worksheet?.getRow(3 + 1 + 1 + sheet.rows.length + 1);
    expect(footerRow?.getCell(1).value).toBe('合計');
  });
});

describe('dilutionRows', () => {
  it('調達後の表の並びで、前後の比率と差を返す', () => {
    const snapshot = sampleSnapshot();
    const before = buildCapTable(snapshot);
    const after = buildCapTable(snapshot, {
      scenario: { pricePerShare: 10_000, newMoney: 100_000_000, newInvestorName: '新ファンド', additionalPoolShares: 1_000 },
    });
    const rows = dilutionRows(before, after);
    expect(rows.map((row) => row.stakeholderId)).toEqual(after.rows.map((row) => row.stakeholderId));
    const investor = rows.find((row) => row.kind === 'new_investor');
    expect(investor).toMatchObject({ name: '新ファンド', beforeShares: 0, beforeRatio: 0, afterShares: 10_000 });
    const existing = rows.filter((row) => row.kind !== 'new_investor' && row.kind !== 'pool' && row.beforeShares > 0);
    expect(existing.length).toBeGreaterThan(0);
    // 転換型の株式数が変わらない既存の株主は、比率が下がる
    for (const row of existing.filter((item) => item.afterShares === item.beforeShares)) expect(row.change).toBeLessThan(0);
    expect(rows.reduce((total, row) => total + row.afterRatio, 0)).toBeCloseTo(1, 9);
  });
});

describe('waterfallHoldings / exitValueSeries / rowKindLabel', () => {
  it('発行済みの種類ごとの株式数を返す', () => {
    const table = buildCapTable(sampleSnapshot());
    const holdings = waterfallHoldings(table);
    expect(holdings.reduce((total, holding) => total + holding.shares, 0)).toBe(table.totals.issuedShares);
  });

  it('売却額の前後 5 点を返し、0 以下は空にする', () => {
    expect(exitValueSeries(1_000_000_000)).toEqual([250_000_000, 500_000_000, 1_000_000_000, 2_000_000_000, 4_000_000_000]);
    expect(exitValueSeries(0)).toEqual([]);
  });

  it('軸の金額表記', () => {
    expect(compactYen(1_650_000_000)).toBe('16.5億');
    expect(compactYen(50_000_000)).toBe('5,000万');
    expect(compactYen(1_234)).toBe('1,234');
  });

  it('区分の表示名', () => {
    expect(rowKindLabel('fund')).toBe('投資事業組合・ファンド');
    expect(rowKindLabel('pool')).toBe('未割当枠');
    expect(rowKindLabel('new_investor')).toBe('新規投資家');
  });
});
