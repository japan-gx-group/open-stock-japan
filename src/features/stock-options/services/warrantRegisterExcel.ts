// 新株予約権原簿を Excel（.xlsx）にする。exceljs は大きいので、出力するときだけ読み込む。
// ブラウザ（Client Component のイベントハンドラ）から呼ぶこと。

import { formatDateJa } from '@/lib/equity/format';
import type { WarrantRegisterRow } from './optionSummary';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const COLUMNS: { header: string; width: number }[] = [
  { header: '氏名又は名称', width: 28 },
  { header: '住所', width: 40 },
  { header: '新株予約権の名称（回次）', width: 28 },
  { header: '新株予約権の内容', width: 70 },
  { header: '数（個）', width: 12 },
  { header: '取得した日', width: 16 },
  { header: '備考', width: 44 },
];

export const buildWarrantRegisterWorkbook = async (
  rows: readonly WarrantRegisterRow[],
  options: { companyName: string; asOf: string },
): Promise<Blob> => {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('新株予約権原簿');
  sheet.columns = COLUMNS.map((column) => ({ width: column.width }));

  sheet.addRow(['新株予約権原簿']).font = { bold: true, size: 14 };
  sheet.addRow([options.companyName]);
  sheet.addRow([`${formatDateJa(options.asOf)} 現在（会社法249条）`]);
  sheet.addRow([]);

  const header = sheet.addRow(COLUMNS.map((column) => column.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF7' } };
    cell.border = { bottom: { style: 'thin' } };
  });

  for (const row of rows) {
    const added = sheet.addRow([
      row.holderName,
      row.address,
      row.planName,
      row.content,
      row.units,
      row.acquiredOn ? formatDateJa(row.acquiredOn) : '',
      row.note,
    ]);
    added.alignment = { vertical: 'top', wrapText: true };
    added.getCell(5).numFmt = '#,##0';
  }
  sheet.views = [{ state: 'frozen', ySplit: 5 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
};
