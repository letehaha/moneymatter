import { describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';

import type { TransactionRow } from '../types';
import { xlsxWriter } from './xlsx-writer';

describe('xlsxWriter money cells', () => {
  it('keeps every stored decimal', async () => {
    const amount = 0.12345678;
    const [file] = await xlsxWriter.write({
      tables: [{ name: 'transactions', rows: [{ amount } as unknown as TransactionRow] }],
      exportedAt: new Date(0),
    });

    const workbook = new ExcelJS.Workbook();
    const bytes = file!.buffer;
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const sheet = workbook.getWorksheet('transactions')!;
    const amountColumn = (sheet.getRow(1).values as unknown[]).indexOf('Amount');
    const cell = sheet.getRow(2).getCell(amountColumn);

    expect(cell.value).toBe(amount);
    expect(cell.numFmt ?? 'General').toBe('General');
  });
});
