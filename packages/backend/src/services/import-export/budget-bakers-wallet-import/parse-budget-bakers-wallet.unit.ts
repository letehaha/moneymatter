import { EXTERNAL_URLS } from '@bt/shared/const/external-urls';
import { BUDGET_BAKERS_WALLET_MAX_ROWS, TRANSACTION_TYPES } from '@bt/shared/types';
import { i18nextReady, t } from '@i18n/index';
import { beforeAll, describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { parseBudgetBakersWalletCsv } from './parse-budget-bakers-wallet.service';

const FIXTURES_DIR = join(__dirname, '../../../tests/fixtures/budget-bakers-wallet-import');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

const WALLET_HEADERS =
  'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels';

const en = ({ key, variables }: { key: string; variables?: Record<string, unknown> }) =>
  t({ key, variables, locale: 'en' });

beforeAll(async () => {
  await i18nextReady;
});

describe('parseBudgetBakersWalletCsv', () => {
  describe('happy path against the basic fixture', () => {
    // T15: run parse inside beforeAll so a missing/broken fixture surfaces as a
    // test failure rather than crashing the describe-block collection phase.
    let result: ReturnType<typeof parseBudgetBakersWalletCsv>;
    beforeAll(() => {
      result = parseBudgetBakersWalletCsv({ fileContent: loadFixture('basic.csv') });
    });

    it('discovers distinct accounts with correct currency and transaction count', () => {
      const mono = result.accounts.find((a) => a.originalName === 'Monobank Black UAH')!;
      expect(mono.currency).toBe('UAH');
      // 2 expenses + 1 restaurant + 1 transfer leg = 4 rows
      expect(mono.transactionCount).toBe(4);
      // signed sum: -400 + -1200 + -350 + -5000 = -6950
      expect(mono.netImportedAmount).toBe(-6950);

      const pko = result.accounts.find((a) => a.originalName === 'PKO Polska bank | USD')!;
      expect(pko.currency).toBe('USD');

      const crypto = result.accounts.find((a) => a.originalName === 'Crypto')!;
      expect(crypto.currency).toBe('USD');
    });

    it('collects non-transfer categories and excludes the transfer-marker', () => {
      const names = result.categories.map((c) => c.name);
      expect(names).toContain('TV, Streaming');
      expect(names).toContain('Groceries');
      expect(names).toContain('Dmytro wage');
      expect(names).toContain('Restaurant');
      // Transfer, withdraw must never appear as a category
      expect(names).not.toContain('Transfer, withdraw');
    });

    it('collects distinct tags with counts', () => {
      const wantTag = result.tags.find((t) => t.name === 'Want')!;
      expect(wantTag).toBeDefined();
      expect(wantTag.transactionCount).toBe(2);

      const needTag = result.tags.find((t) => t.name === 'Need')!;
      expect(needTag).toBeDefined();
      expect(needTag.transactionCount).toBe(1);
    });

    it('pairs the same-currency transfer at 2025-07-31T13:45:00.000Z', () => {
      const sameCcy = result.transfers.find(
        (t) => t.sourceAccountName === 'Crypto' && t.destinationAccountName === 'Wise USD',
      )!;
      expect(sameCcy).toBeDefined();
      expect(sameCcy.sourceAmount).toBe(2100);
      expect(sameCcy.destinationAmount).toBe(2100);
      expect(sameCcy.sourceCurrency).toBe('USD');
      expect(sameCcy.destinationCurrency).toBe('USD');
      expect(sameCcy.date).toBe('2025-07-31T13:45:00.000Z');
    });

    it('pairs the cross-currency transfer at 2025-07-02T09:45:00.000Z with different amounts', () => {
      const crossCcy = result.transfers.find((t) => t.sourceAccountName === 'PKO Polska bank | USD')!;
      expect(crossCcy).toBeDefined();
      expect(crossCcy.sourceAmount).toBe(410.9);
      expect(crossCcy.destinationAmount).toBe(1484.2);
      expect(crossCcy.sourceCurrency).toBe('USD');
      expect(crossCcy.destinationCurrency).toBe('PLN');
    });

    it('emits transfer-counterpart-missing warning for the lone expense leg', () => {
      const codes = result.warnings.map((w) => w.code);
      expect(codes).toContain('transfer-counterpart-missing');
    });

    it('promotes the unpaired transfer leg to an out-of-wallet transaction', () => {
      const outOfWallet = result.transactions.find((t) => t.outOfWallet && t.accountName === 'Monobank Black UAH')!;
      expect(outOfWallet).toBeDefined();
      expect(outOfWallet.categoryName).toBeNull();
      // Expense → negative
      expect(outOfWallet.amount).toBe(-5000);
    });

    it('returns a date range spanning the earliest and latest rows', () => {
      // Earliest: 2025-07-02, Latest: 2025-12-26
      expect(result.dateRange).not.toBeNull();
      expect(result.dateRange!.from).toBe('2025-07-02T09:45:00.000Z');
      expect(result.dateRange!.to).toBe('2025-12-26T19:00:00.000Z');
    });

    it('detects UAH as the base currency (amount == ref_currency_amount for UAH rows)', () => {
      expect(result.detectedBaseCurrency).toBe('UAH');
    });
  });

  describe('amount sign from type', () => {
    it('makes Expense rows have a negative signed amount', () => {
      const csv = [WALLET_HEADERS, 'Bank A;Food;USD;150.50;150.50;Expense;Cash;;2025-01-01T10:00:00.000Z;false;;'].join(
        '\n',
      );
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions[0]!.amount).toBe(-150.5);
      expect(result.transactions[0]!.type).toBe(TRANSACTION_TYPES.expense);
    });

    it('makes Income rows have a positive signed amount', () => {
      const csv = [WALLET_HEADERS, 'Bank A;Salary;USD;3000;3000;Income;Cash;;2025-01-01T10:00:00.000Z;false;;'].join(
        '\n',
      );
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions[0]!.amount).toBe(3000);
      expect(result.transactions[0]!.type).toBe(TRANSACTION_TYPES.income);
    });

    it('carries the real type for a zero-amount row even though its sign is lost', () => {
      // A zero-amount Expense row: `amount` cannot encode the direction
      // (`-0 === 0`), so `type` must be carried straight from the CSV column.
      const csv = [WALLET_HEADERS, 'Bank A;Fees;USD;0;0;Expense;Cash;;2025-01-01T10:00:00.000Z;false;;'].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions[0]!.amount).toBe(0);
      expect(result.transactions[0]!.type).toBe(TRANSACTION_TYPES.expense);
    });
  });

  describe('ordinary vs transfer row classification', () => {
    it('routes transfer=false rows to transactions', () => {
      const csv = [WALLET_HEADERS, 'Bank A;Food;USD;50;50;Expense;Cash;;2025-03-01T12:00:00.000Z;false;;'].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions).toHaveLength(1);
      expect(result.transfers).toHaveLength(0);
    });

    it('routes transfer=true rows through pairing, not directly to transactions', () => {
      const csv = [
        WALLET_HEADERS,
        'Acc A;Transfer, withdraw;USD;100;100;Expense;Cash;;2025-03-01T12:00:00.000Z;true;;',
        'Acc B;Transfer, withdraw;USD;100;100;Income;Cash;;2025-03-01T12:00:00.000Z;true;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transfers).toHaveLength(1);
      // Paired legs must not also appear in transactions
      expect(result.transactions).toHaveLength(0);
    });
  });

  describe('transfer pairing', () => {
    it('pairs exact matching expense+income legs into a WalletParseTransfer', () => {
      const csv = [
        WALLET_HEADERS,
        'Source Acc;Transfer, withdraw;EUR;500;20000;Expense;Cash;;2025-05-10T14:00:00.000Z;true;;',
        'Dest Acc;Transfer, withdraw;EUR;500;20000;Income;Cash;;2025-05-10T14:00:00.000Z;true;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transfers).toHaveLength(1);
      const t = result.transfers[0]!;
      expect(t.sourceAccountName).toBe('Source Acc');
      expect(t.destinationAccountName).toBe('Dest Acc');
      expect(t.sourceAmount).toBe(500);
      expect(t.destinationAmount).toBe(500);
      expect(t.rowIndices).toHaveLength(2);
    });

    it('pairs a cross-currency transfer with different source and destination amounts', () => {
      const csv = [
        WALLET_HEADERS,
        'USD Acc;Transfer, withdraw;USD;1000;41000;Expense;Cash;;2025-05-15T09:00:00.000Z;true;;',
        'UAH Acc;Transfer, withdraw;UAH;41000;41000;Income;Cash;;2025-05-15T09:00:00.000Z;true;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transfers).toHaveLength(1);
      const t = result.transfers[0]!;
      expect(t.sourceAmount).toBe(1000);
      expect(t.destinationAmount).toBe(41000);
      expect(t.sourceCurrency).toBe('USD');
      expect(t.destinationCurrency).toBe('UAH');
    });

    it('pairs legs within 1% ref_currency_amount tolerance (fuzzy match)', () => {
      // ref amounts: 10000 vs 10090 → delta 90, max 10090 → 0.89% < 1% → should pair
      const csv = [
        WALLET_HEADERS,
        'Acc A;Transfer, withdraw;EUR;250;10000;Expense;Cash;;2025-06-01T08:00:00.000Z;true;;',
        'Acc B;Transfer, withdraw;UAH;9800;10090;Income;Cash;;2025-06-01T08:00:00.000Z;true;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transfers).toHaveLength(1);
      expect(result.warnings.some((w) => w.code === 'transfer-counterpart-missing')).toBe(false);
    });

    it('does NOT pair legs exceeding 1% ref_currency_amount tolerance', () => {
      // ref amounts: 10000 vs 10200 → delta 200, max 10200 → 1.96% > 1% → no pair
      const csv = [
        WALLET_HEADERS,
        'Acc A;Transfer, withdraw;EUR;250;10000;Expense;Cash;;2025-06-01T08:00:00.000Z;true;;',
        'Acc B;Transfer, withdraw;UAH;9800;10200;Income;Cash;;2025-06-01T08:00:00.000Z;true;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transfers).toHaveLength(0);
      const codes = result.warnings.map((w) => w.code);
      expect(codes).toContain('transfer-counterpart-missing');
    });

    it('does NOT pair legs from the same account', () => {
      const csv = [
        WALLET_HEADERS,
        'Same Acc;Transfer, withdraw;USD;100;100;Expense;Cash;;2025-06-01T08:00:00.000Z;true;;',
        'Same Acc;Transfer, withdraw;USD;100;100;Income;Cash;;2025-06-01T08:00:00.000Z;true;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transfers).toHaveLength(0);
    });

    it('promotes an unpaired leg to an out-of-wallet transaction with warning', () => {
      const csv = [
        WALLET_HEADERS,
        'Acc X;Transfer, withdraw;USD;300;300;Expense;Cash;;2025-06-05T10:00:00.000Z;true;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transfers).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.outOfWallet).toBe(true);
      expect(result.transactions[0]!.categoryName).toBeNull();
      expect(result.transactions[0]!.amount).toBe(-300);
      const codes = result.warnings.map((w) => w.code);
      expect(codes).toContain('transfer-counterpart-missing');
    });
  });

  describe('tag collection vs transfer legs', () => {
    it('does not count a label that appears only on a paired transfer leg', () => {
      // The two legs pair into a WalletParseTransfer, which carries no tag. The
      // label must therefore not surface as an importable tag — otherwise the
      // execute step would create it and bump `tagsCreated` while attaching it to
      // nothing.
      const csv = [
        WALLET_HEADERS,
        'Acc A;Transfer, withdraw;USD;100;100;Expense;Cash;;2025-08-01T10:00:00.000Z;true;;TransferLabel',
        'Acc B;Transfer, withdraw;USD;100;100;Income;Cash;;2025-08-01T10:00:00.000Z;true;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transfers).toHaveLength(1);
      expect(result.tags).toHaveLength(0);
    });

    it('still counts a label on an unpaired (out-of-wallet) transfer leg', () => {
      // An unpaired leg becomes an out-of-wallet transaction that DOES carry its
      // tag, so the label must still be collected.
      const csv = [
        WALLET_HEADERS,
        'Acc X;Transfer, withdraw;USD;300;300;Expense;Cash;;2025-08-05T10:00:00.000Z;true;;OutLabel',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.outOfWallet).toBe(true);
      expect(result.tags.find((t) => t.name === 'OutLabel')).toBeDefined();
    });
  });

  describe('date format handling', () => {
    it('accepts ISO-8601 UTC date format', () => {
      const csv = [WALLET_HEADERS, 'Bank;Food;USD;10;10;Expense;Cash;;2025-06-15T08:30:00.000Z;false;;'].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions[0]!.date).toBe('2025-06-15T08:30:00.000Z');
    });

    it('accepts DD/MM/YYYY HH:MM date format and normalizes to ISO instant', () => {
      const csv = [WALLET_HEADERS, 'Bank;Food;USD;10;10;Expense;Cash;;15/06/2025 08:30;false;;'].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions[0]!.date).toBe('2025-06-15T08:30:00.000Z');
    });
  });

  describe('malformed rows are skipped with warnings', () => {
    it('skips rows with empty account and emits row-skipped warning', () => {
      const csv = [
        WALLET_HEADERS,
        ';Food;USD;10;10;Expense;Cash;;2025-01-01T00:00:00.000Z;false;;',
        'Bank;Food;USD;20;20;Income;Cash;;2025-01-02T00:00:00.000Z;false;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions).toHaveLength(1);
      expect(result.warnings.some((w) => w.code === 'row-skipped')).toBe(true);
    });

    it('skips rows with unparseable amount and emits unparseable-amount warning', () => {
      const csv = [
        WALLET_HEADERS,
        'Bank;Food;USD;notanumber;10;Expense;Cash;;2025-01-01T00:00:00.000Z;false;;',
        'Bank;Food;USD;50;50;Income;Cash;;2025-01-02T00:00:00.000Z;false;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions).toHaveLength(1);
      expect(result.warnings.some((w) => w.code === 'unparseable-amount')).toBe(true);
    });

    it('skips rows with unparseable date and emits unparseable-date warning', () => {
      const csv = [
        WALLET_HEADERS,
        'Bank;Food;USD;10;10;Expense;Cash;;not-a-date;false;;',
        'Bank;Food;USD;50;50;Income;Cash;;2025-01-02T00:00:00.000Z;false;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions).toHaveLength(1);
      expect(result.warnings.some((w) => w.code === 'unparseable-date')).toBe(true);
    });
  });

  describe('input validation', () => {
    it('throws on an empty file', () => {
      expect(() => parseBudgetBakersWalletCsv({ fileContent: '   ' })).toThrow(
        en({ key: 'importExport.budgetBakersWallet.parse.fileEmpty' }),
      );
    });

    it('throws on a file missing required columns', () => {
      const csv = 'account;currency;amount\nBank;USD;100\n';
      expect(() => parseBudgetBakersWalletCsv({ fileContent: csv })).toThrow(
        en({
          key: 'importExport.budgetBakersWallet.parse.missingColumns',
          variables: {
            columns: 'category, ref_currency_amount, type, payment_type, note, date, transfer, payee, labels',
          },
        }),
      );
    });

    it('throws when all rows are unparseable', () => {
      const csv = [WALLET_HEADERS, ';Food;USD;10;10;Expense;Cash;;2025-01-01T00:00:00.000Z;false;;'].join('\n');
      expect(() => parseBudgetBakersWalletCsv({ fileContent: csv })).toThrow(
        en({ key: 'importExport.budgetBakersWallet.parse.noUsableRows' }),
      );
    });

    // T2: BUDGET_BAKERS_WALLET_MAX_ROWS boundary — one row over the limit must throw.
    it('throws when the CSV exceeds BUDGET_BAKERS_WALLET_MAX_ROWS data rows', () => {
      // Build a minimal valid data row repeated BUDGET_BAKERS_WALLET_MAX_ROWS + 1 times.
      const dataRow = 'Bank;Food;USD;10;10;Expense;Cash;;2025-01-01T00:00:00.000Z;false;;';
      const rows = Array.from({ length: BUDGET_BAKERS_WALLET_MAX_ROWS + 1 }, () => dataRow);
      const csv = [WALLET_HEADERS, ...rows].join('\n');
      expect(() => parseBudgetBakersWalletCsv({ fileContent: csv })).toThrow(
        en({
          key: 'importExport.budgetBakersWallet.parse.tooManyRows',
          variables: { rows: BUDGET_BAKERS_WALLET_MAX_ROWS + 1, max: BUDGET_BAKERS_WALLET_MAX_ROWS },
        }),
      );
    });
  });

  // T3: unknown type value — row must be skipped with a row-skipped warning.
  describe('unknown row type', () => {
    it('skips rows with an unknown type and emits a row-skipped warning', () => {
      const csv = [
        WALLET_HEADERS,
        // 'Savings' is not 'Expense' or 'Income' — the parser must skip it.
        'Bank;Food;USD;100;100;Savings;Cash;;2025-01-01T10:00:00.000Z;false;;',
        // A valid row so the file is not "all rows skipped".
        'Bank;Food;USD;50;50;Income;Cash;;2025-01-02T10:00:00.000Z;false;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      // The unknown-type row must not appear as a transaction.
      expect(result.transactions).toHaveLength(1);
      // A row-skipped warning must be emitted for the unknown type.
      const skipped = result.warnings.filter((w) => w.code === 'row-skipped');
      expect(skipped).toHaveLength(1);
      expect(skipped[0]!.message).toBe(
        en({ key: 'importExport.budgetBakersWallet.warnings.unknownType', variables: { value: 'Savings' } }),
      );
    });
  });

  // T4: UTF-8 BOM prefix — headers must be recognized and rows parsed normally.
  describe('UTF-8 BOM handling', () => {
    it('parses a BOM-prefixed CSV without stray BOM characters in header keys', () => {
      // U+FEFF is the UTF-8 BOM. csv-parse's `bom: true` option strips it so
      // the first header key is 'account', not '﻿account'.
      const bom = '﻿';
      const csv = [bom + WALLET_HEADERS, 'Bank;Food;USD;200;200;Expense;Cash;;2025-03-01T08:00:00.000Z;false;;'].join(
        '\n',
      );
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      // If the BOM leaked into the 'account' header key, the row would be
      // skipped (no account name) and transactions would be empty.
      expect(result.transactions).toHaveLength(1);
      expect(result.accounts[0]!.originalName).toBe('Bank');
    });
  });

  // T5: unparseable ref_currency_amount with valid amount — row skipped + warning.
  describe('unparseable ref_currency_amount', () => {
    it('skips a row with a garbage ref_currency_amount and emits an unparseable-amount warning', () => {
      const csv = [
        WALLET_HEADERS,
        // Valid amount but garbage ref_currency_amount.
        'Bank;Food;USD;150;garbage_ref;Expense;Cash;;2025-04-01T10:00:00.000Z;false;;',
        // Valid row to keep the file non-empty.
        'Bank;Food;USD;50;50;Income;Cash;;2025-04-02T10:00:00.000Z;false;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions).toHaveLength(1);
      const warnings = result.warnings.filter((w) => w.code === 'unparseable-amount');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.message).toBe(
        en({
          key: 'importExport.budgetBakersWallet.warnings.unparseableRefAmount',
          variables: { value: 'garbage_ref' },
        }),
      );
    });
  });

  // T13: transfer pairing with competing income legs — greedy pick + loser becomes unpaired.
  describe('transfer pairing with competing income legs', () => {
    it('greedily pairs each expense with the best income, leaving the losing income unpaired', () => {
      // Two expense legs and one income leg all share the same timestamp and
      // compatible ref amounts. The pairing algorithm matches the first expense
      // to the best-matching income; the second expense finds no remaining
      // income and becomes an unpaired out-of-wallet transaction.
      //
      // Per parse-wallet.service.ts pairTransfers(): expenses are processed in
      // iteration order. The first expense (Acc A, ref 1000) finds the income
      // (Acc B, ref 1000) as the best match (exact delta 0) and claims it.
      // The second expense (Acc C, ref 1000) has no unclaimed income left and
      // is promoted to out-of-wallet with a transfer-counterpart-missing warning.
      const csv = [
        WALLET_HEADERS,
        'Acc A;Transfer, withdraw;USD;100;1000;Expense;Cash;;2025-05-01T12:00:00.000Z;true;;',
        'Acc B;Transfer, withdraw;USD;100;1000;Income;Cash;;2025-05-01T12:00:00.000Z;true;;',
        'Acc C;Transfer, withdraw;USD;100;1000;Expense;Cash;;2025-05-01T12:00:00.000Z;true;;',
      ].join('\n');

      const result = parseBudgetBakersWalletCsv({ fileContent: csv });

      // Exactly one paired transfer (Acc A → Acc B).
      expect(result.transfers).toHaveLength(1);
      expect(result.transfers[0]!.sourceAccountName).toBe('Acc A');
      expect(result.transfers[0]!.destinationAccountName).toBe('Acc B');

      // The second expense (Acc C) becomes an unpaired out-of-wallet transaction.
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.outOfWallet).toBe(true);
      expect(result.transactions[0]!.accountName).toBe('Acc C');

      // A transfer-counterpart-missing warning must be emitted for Acc C.
      const missing = result.warnings.filter((w) => w.code === 'transfer-counterpart-missing');
      expect(missing).toHaveLength(1);
      expect(missing[0]!.rowIndex).toBe(result.transactions[0]!.rowIndex);
    });
  });

  // Wallet writes the `type` column in the app's UI language, so a Spanish
  // export uses Gasto/Ingreso rather than Expense/Income.
  describe('Spanish-locale export', () => {
    it('interprets Gasto as an expense (negative) and Ingreso as income (positive)', () => {
      const csv = [
        WALLET_HEADERS,
        'ITAU $;Internet;UYU;2247;2247;Gasto;Efectivo;Internet;2026-06-16T15:00:00.000Z;false;Antel;',
        'ITAU Pocket;Regalos;UYU;2918.33;2918.33;Ingreso;Transferencia bancaria;;2026-06-16T14:10:29.581Z;false;Papá;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });

      const expense = result.transactions.find((t) => t.accountName === 'ITAU $')!;
      expect(expense.amount).toBe(-2247);
      expect(expense.type).toBe(TRANSACTION_TYPES.expense);

      const income = result.transactions.find((t) => t.accountName === 'ITAU Pocket')!;
      expect(income.amount).toBe(2918.33);
      expect(income.type).toBe(TRANSACTION_TYPES.income);
    });

    it('parses a Spanish export instead of skipping every row (regression)', () => {
      // Before localized type values, every Spanish row was skipped as an
      // "unknown type", surfacing as "No usable rows found".
      const csv = [
        WALLET_HEADERS,
        'ITAU Pocket;Compras;UYU;250;250;Gasto;Transferencia bancaria;Clips;2026-06-16T18:17:19.587Z;false;;Recompensas',
        'ITAU Pocket;Bar, cafetería;UYU;882.56;882.56;Gasto;Tarjeta de débito;;2026-06-14T21:21:15.000Z;false;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions).toHaveLength(2);
      expect(result.warnings.filter((w) => w.code === 'row-skipped')).toHaveLength(0);
    });

    it('excludes the Spanish transfer-marker category "Transferir, retirar"', () => {
      const csv = [
        WALLET_HEADERS,
        'ITAU $;Transferir, retirar;UYU;640;640;Gasto;Efectivo;;2026-06-16T17:44:03.000Z;true;;',
        'ITAU Pocket;Transferir, retirar;UYU;640;640;Ingreso;Efectivo;;2026-06-16T17:44:03.000Z;true;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      // The two legs pair into a transfer; the marker must never surface as a category.
      expect(result.transfers).toHaveLength(1);
      expect(result.categories.map((c) => c.name)).not.toContain('Transferir, retirar');
    });
  });

  describe('unsupported export language', () => {
    it('throws a roadmap-pointing error when no row type is recognized', () => {
      // German type values (Ausgabe/Einnahme) are not supported yet, so every row
      // is skipped and the parser must name the real cause instead of "unparseable".
      const csv = [
        WALLET_HEADERS,
        'Konto;Essen;EUR;10;10;Ausgabe;Bar;;2025-01-01T10:00:00.000Z;false;;',
        'Konto;Gehalt;EUR;100;100;Einnahme;Bar;;2025-01-02T10:00:00.000Z;false;;',
      ].join('\n');
      expect(() => parseBudgetBakersWalletCsv({ fileContent: csv })).toThrow(
        en({
          key: 'importExport.budgetBakersWallet.parse.unsupportedLanguage',
          variables: { url: EXTERNAL_URLS.featurebaseRoadmap },
        }),
      );
    });

    it('still skips a lone unrecognized-type row when other rows parse', () => {
      const csv = [
        WALLET_HEADERS,
        'Konto;Essen;EUR;10;10;Ausgabe;Bar;;2025-01-01T10:00:00.000Z;false;;',
        'Bank;Food;USD;50;50;Income;Cash;;2025-01-02T10:00:00.000Z;false;;',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });
      expect(result.transactions).toHaveLength(1);
      expect(result.warnings.some((w) => w.code === 'row-skipped')).toBe(true);
    });
  });

  // Wallet joins several labels on one row with ", " in the `labels` cell, so a
  // single cell like "Maru, Ahorro" must yield two distinct tags both attached to
  // the row — not one combined "Maru, Ahorro" tag.
  describe('comma-separated labels', () => {
    it('splits a multi-label cell into distinct tags attached to the transaction', () => {
      const csv = [
        WALLET_HEADERS,
        'Acc;Food;USD;10;10;Expense;Cash;Lunch;2025-01-01T10:00:00.000Z;false;;Maru, Ahorro',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.tags).toEqual(['Maru', 'Ahorro']);
      expect(result.tags.map((t) => t.name).toSorted()).toEqual(['Ahorro', 'Maru']);
    });

    it('counts each label across rows independently', () => {
      const csv = [
        WALLET_HEADERS,
        'Acc;Food;USD;10;10;Expense;Cash;;2025-01-01T10:00:00.000Z;false;;Ahorro, Recompensas',
        'Acc;Food;USD;20;20;Expense;Cash;;2025-01-02T10:00:00.000Z;false;;Ahorro',
      ].join('\n');
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });

      const ahorro = result.tags.find((t) => t.name === 'Ahorro')!;
      const recompensas = result.tags.find((t) => t.name === 'Recompensas')!;
      expect(ahorro.transactionCount).toBe(2);
      expect(recompensas.transactionCount).toBe(1);
    });

    it('treats a single-label cell as one tag (no regression)', () => {
      const csv = [WALLET_HEADERS, 'Acc;Food;USD;10;10;Expense;Cash;;2025-01-01T10:00:00.000Z;false;;Recompensas'].join(
        '\n',
      );
      const result = parseBudgetBakersWalletCsv({ fileContent: csv });

      expect(result.transactions[0]!.tags).toEqual(['Recompensas']);
      expect(result.tags.map((t) => t.name)).toEqual(['Recompensas']);
    });
  });
});
