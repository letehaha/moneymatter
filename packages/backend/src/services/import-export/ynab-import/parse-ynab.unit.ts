import { i18nextReady, t } from '@i18n/index';
import { beforeAll, describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { parseYnabRegister } from './parse-ynab.service';

const FIXTURES_DIR = join(__dirname, '../../../tests/fixtures/ynab-import');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

const YNAB_HEADERS =
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"';

const en = ({ key, variables }: { key: string; variables?: Record<string, unknown> }) =>
  t({ key, variables, locale: 'en' });

beforeAll(async () => {
  await i18nextReady;
});

describe('parseYnabRegister', () => {
  describe('happy path against the basic fixture', () => {
    const result = parseYnabRegister({ fileContent: loadFixture('register-basic.csv') });

    it('discovers every distinct account with detected currency and starting balance', () => {
      expect(result.accounts).toHaveLength(3);

      const checking = result.accounts.find((a) => a.originalName === 'Checking (USD) – 1234')!;
      expect(checking.detectedCurrency).toBe('USD');
      expect(checking.startingBalance).toBe(1500);
      // 3 ordinary tx (Acme, Coffee, Employer) + 1 transfer leg on this
      // account; the synthetic Starting Balance row is excluded.
      expect(checking.transactionCount).toBe(4);

      const savings = result.accounts.find((a) => a.originalName === 'Savings (EUR) – 5678')!;
      expect(savings.detectedCurrency).toBe('EUR');
      expect(savings.startingBalance).toBe(0);
      expect(savings.transactionCount).toBe(1);

      const cash = result.accounts.find((a) => a.originalName === 'Cash (PLN) – 9999')!;
      expect(cash.detectedCurrency).toBe('PLN');
      // PLN account had a $50 outflow on the synthetic Starting Balance row
      // → signed balance is -50, modeling YNAB's "you started in the red" case.
      expect(cash.startingBalance).toBe(-50);
      expect(cash.transactionCount).toBe(1);
    });

    it('builds the category hierarchy from the combined column', () => {
      const fullNames = result.categories.map((c) => c.fullName);
      expect(fullNames).toEqual(expect.arrayContaining(['Bills: Utilities', 'Wants: Dining', 'Needs: Groceries']));
      // "Inflow: Ready to Assign" is YNAB's pseudo-category for income; we
      // strip it so the user does not end up with a junk parent category.
      expect(fullNames).not.toContain('Inflow: Ready to Assign');
    });

    it('lists distinct payees excluding Starting Balance and Transfer : rows', () => {
      const names = result.payees.map((p) => p.name).toSorted();
      expect(names).toEqual(['Acme Corp', 'Carrefour', 'Coffee Shop', 'Employer Inc']);
    });

    it('pairs Transfer : rows on the two sides of the same date + amount', () => {
      expect(result.transfers).toHaveLength(1);
      const xfer = result.transfers[0]!;
      expect(xfer.sourceAccountName).toBe('Checking (USD) – 1234');
      expect(xfer.destinationAccountName).toBe('Savings (EUR) – 5678');
      expect(xfer.amount).toBe(500);
      expect(xfer.flag).toBe('blue');
    });

    it('summarises flag colors used so the wizard can preview tags', () => {
      const colors = result.tagsUsed.map((t) => t.color).toSorted();
      expect(colors).toEqual(['blue', 'green', 'red', 'yellow']);
    });

    it('returns a date range spanning the earliest and latest data row', () => {
      expect(result.dateRange).toEqual({ from: '2026-06-01', to: '2026-06-06' });
    });

    it('treats Inflow rows under "Inflow: Ready to Assign" as income with no category', () => {
      const salary = result.transactions.find((t) => t.payeeName === 'Employer Inc')!;
      expect(salary.amount).toBe(3200);
      expect(salary.categoryGroup).toBeNull();
      expect(salary.categoryName).toBeNull();
    });
  });

  describe('input validation', () => {
    it('throws on an empty file', () => {
      expect(() => parseYnabRegister({ fileContent: '   ' })).toThrow(en({ key: 'importExport.ynab.parse.fileEmpty' }));
    });

    it('throws on a file missing required YNAB columns', () => {
      const fileContent = '"Date","Payee","Outflow","Inflow"\n"06/01/2026","Test","$0.00","$1.00"\n';
      expect(() => parseYnabRegister({ fileContent })).toThrow(
        en({
          key: 'importExport.ynab.parse.missingColumns',
          variables: { columns: 'Account, Flag, Category Group/Category, Category Group, Category, Memo' },
        }),
      );
    });
  });

  describe('warnings', () => {
    it('emits transfer-counterpart-missing when only one leg of a transfer is present', () => {
      // Single-sided transfer: an outflow from Checking to a counterpart that
      // never has a matching inflow row. Parser should NOT swallow it — the
      // wizard surfaces the warning so the user knows the row will land as a
      // plain expense instead of a transfer.
      const fileContent = [
        YNAB_HEADERS,
        `"Checking (USD) – 1234","","06/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$1000.00,"Cleared"`,
        `"Checking (USD) – 1234","","06/05/2026","Transfer : Savings (EUR) – 5678","","","","Move",$500.00,$0.00,"Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });
      const codes = result.warnings.map((w) => w.code);
      expect(codes).toContain('transfer-counterpart-missing');
      // The unmatched leg must fall through to ordinary transactions instead
      // of disappearing — silent drop here would be a real data-loss bug.
      expect(result.transactions.some((t) => t.payeeName.startsWith('Transfer : '))).toBe(true);
    });

    it('emits currency-undetected when the account name has no (CCY) token', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"My Wallet","","06/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"`,
        `"My Wallet","","06/02/2026","Cafe","Wants: Dining","Wants","Dining","Coffee",$3.50,$0.00,"Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });
      const codes = result.warnings.map((w) => w.code);
      expect(codes).toContain('currency-undetected');
      expect(result.accounts[0]!.detectedCurrency).toBeNull();
    });

    it('emits unparseable-amount and skips the row when Outflow is garbage', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"Checking (USD) – 1234","","06/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"`,
        `"Checking (USD) – 1234","","06/02/2026","Cafe","Wants: Dining","Wants","Dining","Coffee","not-money","",`,
        `"Checking (USD) – 1234","","06/03/2026","Acme","Bills: Utilities","Bills","Utilities","Electric",$10.00,$0.00,"Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });
      const codes = result.warnings.map((w) => w.code);
      expect(codes).toContain('unparseable-amount');
      // The garbage row must NOT be silently imported with amount = 0; the
      // surviving real transaction is the only one in the output.
      const realTx = result.transactions.find((t) => t.payeeName === 'Acme');
      expect(realTx).toBeDefined();
      const cafeTx = result.transactions.find((t) => t.payeeName === 'Cafe');
      expect(cafeTx).toBeUndefined();
    });

    it('emits unknown-flag and keeps the row when Flag value is unrecognised', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"Checking (USD) – 1234","","06/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"`,
        `"Checking (USD) – 1234","fuchsia","06/02/2026","Cafe","Wants: Dining","Wants","Dining","Coffee",$3.50,$0.00,"Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });
      const codes = result.warnings.map((w) => w.code);
      expect(codes).toContain('unknown-flag');
      // Row still lands — unknown flag just means no tag, not a dropped row.
      const cafeTx = result.transactions.find((t) => t.payeeName === 'Cafe');
      expect(cafeTx).toBeDefined();
      expect(cafeTx!.flag).toBeNull();
    });

    it('explains the first row-level problem when every row is skipped', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"Checking (USD) – 1234","","not-a-date","Cafe","Wants: Dining","Wants","Dining","Coffee",$3.50,$0.00,"Cleared"`,
        '',
      ].join('\n');
      const problem = en({ key: 'importExport.ynab.warnings.unparseableDate', variables: { value: 'not-a-date' } });
      expect(() => parseYnabRegister({ fileContent })).toThrow(
        en({ key: 'importExport.ynab.parse.noUsableRowsWithProblem', variables: { problem } }),
      );
    });
  });

  describe('non-US budget formats', () => {
    it('parses an INR budget: rupee symbol, lakh grouping and DD/MM/YYYY dates', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"HDFC (INR) – 1234","","01/06/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","₹0.00","₹1,00,000.00","Cleared"`,
        `"HDFC (INR) – 1234","","25/06/2026","Big Bazaar","Needs: Groceries","Needs","Groceries","Weekly shop","₹369.00","₹0.00","Cleared"`,
        `"HDFC (INR) – 1234","","03/07/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","Salary","₹0.00","₹1,23,456.78","Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });

      expect(result.warnings.map((w) => w.code)).not.toContain('unparseable-amount');
      expect(result.warnings.map((w) => w.code)).not.toContain('unparseable-date');
      expect(result.accounts[0]!.startingBalance).toBe(100000);

      const groceries = result.transactions.find((t) => t.payeeName === 'Big Bazaar')!;
      expect(groceries.amount).toBe(-369);
      // 25/06 can only be day-first, so the whole column reads DD/MM/YYYY.
      expect(groceries.date).toBe('2026-06-25');

      const salary = result.transactions.find((t) => t.payeeName === 'Employer')!;
      expect(salary.amount).toBe(123456.78);
      expect(salary.date).toBe('2026-07-03');

      expect(result.dateRange).toEqual({ from: '2026-06-01', to: '2026-07-03' });
    });

    it('parses a EUR budget written with comma decimals and dot grouping', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"Konto (EUR) – 1","","01/06/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","€0,00","€1.234,56","Cleared"`,
        `"Konto (EUR) – 1","","25/06/2026","Rewe","Needs: Groceries","Needs","Groceries","Shop","€1.234,56","€0,00","Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });

      expect(result.accounts[0]!.startingBalance).toBe(1234.56);
      expect(result.transactions.find((t) => t.payeeName === 'Rewe')!.amount).toBe(-1234.56);
    });

    it('parses a zero-decimal JPY budget where the only separator is grouping', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"Bank (JPY) – 1","","2026-01-06","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","¥0","¥1,234","Cleared"`,
        `"Bank (JPY) – 1","","2026-01-07","Konbini","Needs: Groceries","Needs","Groceries","Snack","¥1,234","¥0","Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });

      expect(result.accounts[0]!.startingBalance).toBe(1234);
      const konbini = result.transactions.find((t) => t.payeeName === 'Konbini')!;
      expect(konbini.amount).toBe(-1234);
      expect(konbini.date).toBe('2026-01-07');
      expect(result.warnings.map((w) => w.code)).not.toContain('ambiguous-date-order');
    });

    it('parses YYYY-MM-DD dates', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"Checking (USD) – 1234","","2026-06-01","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"`,
        `"Checking (USD) – 1234","","2026-06-25","Cafe","Wants: Dining","Wants","Dining","Coffee",$3.50,$0.00,"Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });
      expect(result.transactions.find((t) => t.payeeName === 'Cafe')!.date).toBe('2026-06-25');
    });

    it('parses DD.MM.YYYY dates', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"Konto (EUR) – 1","","01.06.2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","€0,00","€100,00","Cleared"`,
        `"Konto (EUR) – 1","","25.06.2026","Rewe","Needs: Groceries","Needs","Groceries","Shop","€3,50","€0,00","Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });
      const rewe = result.transactions.find((t) => t.payeeName === 'Rewe')!;
      expect(rewe.date).toBe('2026-06-25');
      expect(rewe.amount).toBe(-3.5);
    });

    it('falls back to MM/DD/YYYY and warns once when no row disambiguates the date order', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"Checking (USD) – 1234","","06/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"`,
        `"Checking (USD) – 1234","","05/02/2026","Cafe","Wants: Dining","Wants","Dining","Coffee",$3.50,$0.00,"Cleared"`,
        '',
      ].join('\n');
      const result = parseYnabRegister({ fileContent });

      expect(result.transactions.find((t) => t.payeeName === 'Cafe')!.date).toBe('2026-05-02');
      const ambiguous = result.warnings.filter((w) => w.code === 'ambiguous-date-order');
      expect(ambiguous).toHaveLength(1);
      expect(ambiguous[0]!.rowIndex).toBeUndefined();
      expect(ambiguous[0]!.message).toBe(en({ key: 'importExport.ynab.warnings.ambiguousDateOrder' }));
    });

    it('throws when the Date column mixes contradictory day/month orders', () => {
      const fileContent = [
        YNAB_HEADERS,
        `"Checking (USD) – 1234","","25/06/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"`,
        `"Checking (USD) – 1234","","06/25/2026","Cafe","Wants: Dining","Wants","Dining","Coffee",$3.50,$0.00,"Cleared"`,
        '',
      ].join('\n');
      expect(() => parseYnabRegister({ fileContent })).toThrow(en({ key: 'importExport.ynab.parse.mixedDateOrders' }));
    });
  });
});
