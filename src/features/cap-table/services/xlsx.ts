// 表を Excel（.xlsx）にする共通の書き出し。exceljs は重いので、押されたときに動的に読み込む。
// 表の中身（SheetSpec）を作る側は純粋な関数にして、単体テストで確かめる。

export type SheetCell = string | number | null;

export type SheetColumnFormat = 'text' | 'integer' | 'decimal' | 'yen' | 'percent';

export interface SheetColumn {
  header: string;
  format?: SheetColumnFormat;
  /** 列の幅（文字数の目安） */
  width?: number;
}

export interface SheetSpec {
  sheetName: string;
  /** 表の上に置く行（表題・会社名・基準日など） */
  titleLines: string[];
  columns: SheetColumn[];
  rows: SheetCell[][];
  /** 合計の行 */
  footer?: SheetCell[];
  /** 表の下に置く注記 */
  notes?: string[];
}

const NUMBER_FORMATS: Record<SheetColumnFormat, string | null> = {
  text: null,
  integer: '#,##0',
  decimal: '#,##0.##',
  yen: '#,##0',
  percent: '0.00%',
};

/** SheetSpec を .xlsx の Blob にする */
export const sheetToXlsxBlob = async (spec: SheetSpec): Promise<Blob> => {
  const loaded = await import('exceljs');
  const { Workbook } = 'Workbook' in loaded && loaded.Workbook ? loaded : (loaded as unknown as { default: typeof loaded }).default;
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(spec.sheetName.slice(0, 31));

  spec.titleLines.forEach((line, index) => {
    const row = sheet.addRow([line]);
    row.font = index === 0 ? { bold: true, size: 14 } : { size: 11 };
  });
  if (spec.titleLines.length > 0) sheet.addRow([]);

  const header = sheet.addRow(spec.columns.map((column) => column.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  const applyFormats = (row: ReturnType<typeof sheet.addRow>) => {
    spec.columns.forEach((column, index) => {
      const format = NUMBER_FORMATS[column.format ?? 'text'];
      if (format) row.getCell(index + 1).numFmt = format;
    });
  };
  for (const cells of spec.rows) applyFormats(sheet.addRow(cells));
  if (spec.footer) {
    const footer = sheet.addRow(spec.footer);
    footer.font = { bold: true };
    footer.eachCell((cell) => {
      cell.border = { top: { style: 'thin' } };
    });
    applyFormats(footer);
  }
  if (spec.notes && spec.notes.length > 0) {
    sheet.addRow([]);
    for (const note of spec.notes) sheet.addRow([note]).font = { size: 9, color: { argb: 'FF667085' } };
  }

  spec.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width ?? (column.format && column.format !== 'text' ? 14 : 22);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};
