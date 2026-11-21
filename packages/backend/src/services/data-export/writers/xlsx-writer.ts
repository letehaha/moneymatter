import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';

import { columnsFor } from '../registry';
import { totalRowCount } from '../transformers/utils';
import type { BuiltFile, ExportTable } from '../types';
import { rowToValues } from './row-encoder';
import type { ExportWriter, ExportWriterInput } from './types';

const XLSX_MAX_SHEET_NAME = 31;

async function writeXlsx({ tables }: { tables: ExportTable[] }): Promise<BuiltFile> {
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const streamDone = new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  // The streaming writer serializes each row on commit() and drops it, instead
  // of holding a cell object per value (~4 KB/row) plus the whole sheet XML
  // until writeBuffer(). Timestamps are pinned to the epoch so the same input
  // produces the same bytes; SHA-256 round-trip tests assert that.
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });
  workbook.created = new Date(0);
  workbook.modified = new Date(0);

  const sheetNames = new Set<string>();
  for (const table of tables) {
    const columns = columnsFor({ name: table.name });
    const baseName = table.name.length > XLSX_MAX_SHEET_NAME ? table.name.slice(0, XLSX_MAX_SHEET_NAME) : table.name;
    let sheetName = baseName;
    let suffix = 2;
    while (sheetNames.has(sheetName)) {
      const sliceLen = Math.max(0, XLSX_MAX_SHEET_NAME - String(suffix).length - 1);
      sheetName = `${baseName.slice(0, sliceLen)}_${suffix}`;
      suffix += 1;
    }
    sheetNames.add(sheetName);
    const sheet = workbook.addWorksheet(sheetName);

    const header = sheet.addRow(columns.map((c) => c.header));
    header.font = { bold: true };
    header.commit();

    // Money cells keep Excel's General format: a fixed format would cut or pad
    // amounts whose currency has more or fewer than its decimals.
    for (const row of table.rows as unknown as Record<string, unknown>[]) {
      sheet.addRow(rowToValues({ columns, row })).commit();
    }
    sheet.commit();
  }

  await workbook.commit();
  await streamDone;

  return {
    filename: 'data-export.xlsx',
    buffer: Buffer.concat(chunks),
    rowCount: totalRowCount({ tables }),
  };
}

export const xlsxWriter: ExportWriter = {
  async write({ tables }: ExportWriterInput) {
    return [await writeXlsx({ tables })];
  },
};
