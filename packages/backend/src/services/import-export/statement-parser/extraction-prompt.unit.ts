import { describe, expect, it } from '@jest/globals';

import { parseAIResponse } from './extraction-prompt';

const METADATA_LINE = 'ITAU,1234,2026-06-01,2026-06-16,UYU';

function parse({ rows }: { rows: string[] }) {
  return parseAIResponse({ response: [METADATA_LINE, ...rows].join('\n') });
}

describe('parseAIResponse', () => {
  it('parses a well-formed 7-column row', () => {
    const result = parse({ rows: ['2026-06-16 15:00:00,Internet;Antel,Antel,2247,E,,95'] });

    expect(result?.droppedRowCount).toBe(0);
    expect(result?.transactions).toEqual([
      {
        date: '2026-06-16 15:00:00',
        description: 'Internet;Antel',
        merchant: 'Antel',
        amount: 2247,
        type: 'expense',
        balance: undefined,
        confidence: 0.95,
      },
    ]);
  });

  it('reads the metadata line', () => {
    const result = parse({ rows: ['2026-06-16,Coffee,Forajida,882.56,E,,85'] });

    expect(result?.metadata).toEqual({
      bankName: 'ITAU',
      accountNumberLast4: '1234',
      statementPeriod: { from: '2026-06-01', to: '2026-06-16' },
      currencyCode: 'UYU',
    });
  });

  describe('date formats', () => {
    it('keeps a row whose timestamp has fractional seconds', () => {
      const result = parse({ rows: ['2026-06-16 18:17:19.587,Zona;Clips BYD,Sebastian,250,E,,90'] });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions).toHaveLength(1);
      expect(result?.transactions[0]?.date).toBe('2026-06-16 18:17:19');
      expect(result?.transactions[0]?.amount).toBe(250);
    });

    it('accepts an ISO T separator and normalises it to a space', () => {
      const result = parse({ rows: ['2026-06-16T18:17:19,Zona,Sebastian,250,E,,90'] });

      expect(result?.transactions[0]?.date).toBe('2026-06-16 18:17:19');
    });

    it('accepts a date with no time at all', () => {
      const result = parse({ rows: ['2026-06-16,Zona,Sebastian,250,E,,90'] });

      expect(result?.transactions[0]?.date).toBe('2026-06-16');
    });

    it('drops a row whose date is unreadable', () => {
      const result = parse({ rows: ['16/06/2026,Zona,Sebastian,250,E,,90'] });

      expect(result?.transactions).toHaveLength(0);
      expect(result?.droppedRowCount).toBe(1);
    });

    it('counts an unreadable date among the dropped rows', () => {
      const result = parse({
        rows: ['2026-06-16,Zona,Sebastian,250,E,,90', 'not-a-date,Other,Someone,10,E,,90'],
      });

      expect(result?.transactions).toHaveLength(1);
      expect(result?.droppedRowCount).toBe(1);
    });
  });

  describe('rows with a column too many', () => {
    it('realigns an 8-column row from its trailing columns', () => {
      const result = parse({ rows: ['2026-06-14 12:49:08.364,Queseria Fama,,Queseria Fama,1115,E,,80'] });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions[0]).toEqual({
        date: '2026-06-14 12:49:08',
        description: 'Queseria Fama',
        merchant: 'Queseria Fama',
        amount: 1115,
        type: 'expense',
        balance: undefined,
        confidence: 0.8,
      });
    });

    it('realigns an 8-column row that has no merchant', () => {
      const result = parse({ rows: ['2026-06-16 17:44:03,Transferencia efectiva,,,640,E,,80'] });

      expect(result?.transactions[0]).toEqual({
        date: '2026-06-16 17:44:03',
        description: 'Transferencia efectiva',
        merchant: undefined,
        amount: 640,
        type: 'expense',
        balance: undefined,
        confidence: 0.8,
      });
    });

    it('keeps the balance column when a wide row carries one', () => {
      const result = parse({ rows: ['2026-06-16 17:44:03,Salary,,,640,I,5000.25,80'] });

      expect(result?.transactions[0]?.amount).toBe(640);
      expect(result?.transactions[0]?.type).toBe('income');
      expect(result?.transactions[0]?.balance).toBe(5000.25);
    });
  });

  describe('original amount and reference columns', () => {
    it('reads the original amount, its currency and the reference', () => {
      const result = parse({ rows: ['2026-06-16,Netflix,Netflix,520.40,E,,95,12.99,usd,Ref 8F2K91'] });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions[0]).toEqual({
        date: '2026-06-16',
        description: 'Netflix',
        merchant: 'Netflix',
        amount: 520.4,
        type: 'expense',
        balance: undefined,
        confidence: 0.95,
        originalAmount: 12.99,
        originalCurrencyCode: 'USD',
        externalReference: 'Ref 8F2K91',
      });
    });

    it('reads a 7-column row with the new fields left empty', () => {
      const result = parse({ rows: ['2026-06-16,Shop,Shop,250,E,,90'] });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions[0]?.amount).toBe(250);
      expect(result?.transactions[0]?.originalAmount).toBeUndefined();
      expect(result?.transactions[0]?.originalCurrencyCode).toBeUndefined();
      expect(result?.transactions[0]?.externalReference).toBeUndefined();
    });

    it('reads a 9-column row whose trailing reference was left off', () => {
      const result = parse({ rows: ['2026-06-16,Netflix,Netflix,520.40,E,,95,12.99,USD'] });

      expect(result?.transactions[0]?.amount).toBe(520.4);
      expect(result?.transactions[0]?.originalAmount).toBe(12.99);
      expect(result?.transactions[0]?.originalCurrencyCode).toBe('USD');
      expect(result?.transactions[0]?.externalReference).toBeUndefined();
    });

    it('reads an 8-column row with E/I fifth as a normal row, not a wide one', () => {
      const result = parse({ rows: ['2026-06-16,Shop,Shop,250,E,,90,12.99'] });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions[0]).toMatchObject({ description: 'Shop', merchant: 'Shop', amount: 250 });
      expect(result?.transactions[0]?.originalAmount).toBeUndefined();
    });

    it.each([
      ['an amount without a currency', '12.99,'],
      ['a currency without an amount', ',USD'],
      ['an unknown currency code', '12.99,ZZZ'],
      ['a currency symbol instead of a code', '12.99,US$'],
      ['a zero amount', '0,USD'],
      ['an unreadable amount', '$12.99,USD'],
    ])('keeps the row but drops the pair for %s', (_label, pair) => {
      const result = parse({ rows: [`2026-06-16,Netflix,Netflix,520.40,E,,95,${pair},8F2K91`] });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions[0]?.amount).toBe(520.4);
      expect(result?.transactions[0]?.originalAmount).toBeUndefined();
      expect(result?.transactions[0]?.originalCurrencyCode).toBeUndefined();
      expect(result?.transactions[0]?.externalReference).toBe('8F2K91');
    });

    it('caps the reference at 255 characters', () => {
      const result = parse({ rows: [`2026-06-16,Shop,Shop,250,E,,90,,,${'A'.repeat(300)}`] });

      expect(result?.transactions[0]?.externalReference).toHaveLength(255);
    });

    it('maps a wide row that also carries the new columns', () => {
      const result = parse({
        rows: ['2026-06-14 12:49:08,Queseria Fama,,Queseria Fama,1115,E,,80,12.50,EUR,AB12'],
      });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions[0]).toEqual({
        date: '2026-06-14 12:49:08',
        description: 'Queseria Fama',
        merchant: 'Queseria Fama',
        amount: 1115,
        type: 'expense',
        balance: undefined,
        confidence: 0.8,
        originalAmount: 12.5,
        originalCurrencyCode: 'EUR',
        externalReference: 'AB12',
      });
    });
  });

  describe('amounts', () => {
    it('drops a row whose amount is zero instead of passing it on to the import', () => {
      const result = parse({
        rows: ['2026-06-16,Real one,Shop,250,E,,90', '2026-06-16,Broken,,0,E,,90'],
      });

      expect(result?.transactions).toHaveLength(1);
      expect(result?.transactions[0]?.description).toBe('Real one');
      expect(result?.droppedRowCount).toBe(1);
    });

    it('drops a row whose amount is not a number', () => {
      const result = parse({
        rows: ['2026-06-16,Real one,Shop,250,E,,90', '2026-06-16,Broken,Shop,n/a,E,,90'],
      });

      expect(result?.transactions).toHaveLength(1);
      expect(result?.droppedRowCount).toBe(1);
    });

    // A comma reaches the amount parser only when the model quoted the field. Unquoted it
    // is a column break, and nothing downstream can tell "1,234.56" from two cells.
    it.each([
      ['a whole number', '250', 250],
      ['two decimals', '250.50', 250.5],
      ['a leading dot', '.99', 0.99],
      ['many decimals', '0.123456', 0.123456],
      ['a quoted US grouping', '"1,234.56"', 1234.56],
      ['a quoted European grouping', '"1.234,56"', 1234.56],
      ['a quoted decimal comma', '"1234,56"', 1234.56],
      ['a space as thousands separator', '1 234.56', 1234.56],
    ])('keeps an amount written as %s', (_label, amountStr, expected) => {
      const result = parse({ rows: [`2026-06-16,Shop,Shop,${amountStr},E,,90`] });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions[0]?.amount).toBe(expected);
    });

    it.each([
      ['a currency symbol', '$250.50'],
      ['a trailing unit', '250.50 UYU'],
      ['scientific notation', '1e3'],
      ['an ambiguous lone separator', '"1,234"'],
    ])('drops an amount written with %s', (_label, amountStr) => {
      const result = parse({
        rows: ['2026-06-16,Real one,Shop,250,E,,90', `2026-06-16,Broken,Shop,${amountStr},E,,90`],
      });

      expect(result?.transactions).toHaveLength(1);
      expect(result?.transactions[0]?.description).toBe('Real one');
      expect(result?.droppedRowCount).toBe(1);
    });

    it.each([
      ['a US grouping', '"1,234.56"', 1234.56],
      ['a European grouping', '"1.234,56"', 1234.56],
      ['a decimal comma', '"5000,25"', 5000.25],
      ['a negative balance (overdrawn account)', '-1250.75', -1250.75],
    ])('keeps a balance written as %s without dropping the row', (_label, balanceStr, expected) => {
      const result = parse({ rows: [`2026-06-16,Shop,Shop,250,E,${balanceStr},90`] });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions[0]?.balance).toBe(expected);
    });

    it('keeps the row but drops the balance when the balance is unreadable', () => {
      const result = parse({ rows: ['2026-06-16,Shop,Shop,250,E,n/a,90'] });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions[0]?.amount).toBe(250);
      expect(result?.transactions[0]?.balance).toBeUndefined();
    });

    it('drops a negative amount — direction is the type column, not the sign', () => {
      const result = parse({
        rows: ['2026-06-16,Real one,Shop,250,E,,90', '2026-06-16,Broken,Shop,-40,E,,90'],
      });

      expect(result?.transactions).toHaveLength(1);
      expect(result?.droppedRowCount).toBe(1);
    });
  });

  describe('the statement this parser was fixed for', () => {
    // A Uruguayan multi-account export: milliseconds on every timestamp, and an extra
    // column on the rows where the model filled in a payee.
    const ROWS = [
      '2026-06-16 18:17:19.587,Zona;Clips BYD,Sebastian,250,E,,90',
      '2026-06-16 17:44:03,Transferencia efectiva,,,640,E,,80',
      '2026-06-16 15:00:00,Internet;Antel,Antel,2247,E,,95',
      '2026-06-16 14:10:29.581,Regalo,Padre,2918.33,I,,85',
      '2026-06-14 12:49:08.364,Queseria Fama,,Queseria Fama,1115,E,,80',
      '2026-06-13 08:40:29.835,iCloud+;BBVA U$S,Apple,0.99,E,,90',
    ];

    it('keeps every row', () => {
      const result = parse({ rows: ROWS });

      expect(result?.droppedRowCount).toBe(0);
      expect(result?.transactions).toHaveLength(ROWS.length);
    });

    it('gives every kept row an amount the import will accept', () => {
      const result = parse({ rows: ROWS });

      for (const transaction of result!.transactions) {
        expect(transaction.amount).toBeGreaterThan(0);
      }
    });

    it('reads the sub-cent-adjacent amount rather than shifting a column', () => {
      const result = parse({ rows: ROWS });

      expect(result?.transactions.find((tx) => tx.description === 'iCloud+;BBVA U$S')?.amount).toBe(0.99);
    });
  });

  it('strips a markdown fence the model added despite instructions', () => {
    const result = parseAIResponse({
      response: ['```csv', METADATA_LINE, '2026-06-16,Zona,Sebastian,250,E,,90', '```'].join('\n'),
    });

    expect(result?.transactions).toHaveLength(1);
  });

  describe('a response no transaction can be read from', () => {
    // A local model can leave the amount out of every row. Nothing is recoverable, but the
    // caller still has to tell the user that rows were seen and rejected.
    const ROWS_WITHOUT_AMOUNTS = [
      '2026-06-16 18:17:19,Clips BYD;Recompensas;Sebastián,,E,,100',
      '2026-06-16 17:44:03,Transferir, retirar;Efectivo,,,,E,,100',
      '2026-06-16 15:00:00,Internet,Efectivo;Internet,,E,,100',
      '2026-06-15 15:00:00,"Deporte activo, fitness";Tarjeta de crédito;Club AEBU,E,,100',
    ];

    it('reports the rows it saw instead of collapsing to null', () => {
      const result = parse({ rows: ROWS_WITHOUT_AMOUNTS });

      expect(result).not.toBeNull();
      expect(result?.transactions).toHaveLength(0);
      expect(result?.droppedRowCount).toBe(ROWS_WITHOUT_AMOUNTS.length);
    });

    it('still reads the metadata line', () => {
      const result = parse({ rows: ROWS_WITHOUT_AMOUNTS });

      expect(result?.metadata.bankName).toBe('ITAU');
    });
  });

  it('returns null when the response carries no CSV at all', () => {
    expect(parseAIResponse({ response: '   ' })).toBeNull();
  });
});
