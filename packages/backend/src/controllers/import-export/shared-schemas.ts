import {
  AccountOptionValue,
  CategoryOptionValue,
  CurrencyOptionValue,
  TagOptionValue,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import type { Equals, Expect, ImportExecuteRequestBase } from '@bt/shared/types';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

const categoryOptionSchema = z.discriminatedUnion('option', [
  z.object({ option: z.literal(CategoryOptionValue.mapDataSourceColumn), columnName: z.string() }),
  z.object({ option: z.literal(CategoryOptionValue.createNewCategories), columnName: z.string() }),
  z.object({ option: z.literal(CategoryOptionValue.existingCategory), categoryId: recordId() }),
]);

const tagOptionSchema = z.object({
  option: z.literal(TagOptionValue.mapDataSourceColumn),
  columnName: z.string(),
});

export const tagMappingValueSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create-new') }),
  z.object({ action: z.literal('link-existing'), tagId: recordId() }),
  z.object({ action: z.literal('skip') }),
]);

const currencyOptionSchema = z.discriminatedUnion('option', [
  z.object({ option: z.literal(CurrencyOptionValue.dataSourceColumn), columnName: z.string() }),
  z.object({ option: z.literal(CurrencyOptionValue.existingCurrency), currencyCode: currencyCode() }),
]);

const transactionTypeOptionSchema = z.discriminatedUnion('option', [
  z.object({
    option: z.literal(TransactionTypeOptionValue.dataSourceColumn),
    columnName: z.string(),
    incomeValues: z.array(z.string()),
    expenseValues: z.array(z.string()),
  }),
  z.object({ option: z.literal(TransactionTypeOptionValue.amountSign) }),
]);

const accountOptionSchema = z.discriminatedUnion('option', [
  z.object({ option: z.literal(AccountOptionValue.dataSourceColumn), columnName: z.string() }),
  z.object({ option: z.literal(AccountOptionValue.existingAccount), accountId: recordId() }),
]);

export const columnMappingConfigSchema = z.object({
  date: z.string(),
  // Required: the wizard forces the user to confirm the day/month order of the
  // date column, so every payload carries an explicit choice.
  dateFieldOrder: z.enum(['day-first', 'month-first']),
  amount: z.string(),
  description: z.string().optional(),
  payee: z.string().optional(),
  category: categoryOptionSchema,
  tags: tagOptionSchema.nullish(),
  currency: currencyOptionSchema,
  transactionType: transactionTypeOptionSchema,
  account: accountOptionSchema,
});

// A coarse bound for every currency. The import checks the per-currency limit
// (`getMaxAmountForDecimals`, lower for 3+ decimals) when it creates the account.
const IMPORT_BALANCE_LIMIT = 1e13;

/**
 * Decimal balance a user enters for an import-created account (the
 * `currentBalance` field on the create-new mappings). `label` prefixes the
 * validation message with the field's user-facing name.
 */
export function boundedImportBalance({ label }: { label: string }): z.ZodNumber {
  const message = `${label} must be between -${IMPORT_BALANCE_LIMIT.toLocaleString('en-US')} and ${IMPORT_BALANCE_LIMIT.toLocaleString('en-US')}`;
  return z.number().min(-IMPORT_BALANCE_LIMIT, message).max(IMPORT_BALANCE_LIMIT, message);
}

export const accountMappingValueSchema = z.discriminatedUnion('action', [
  // `currentBalance` is a decimal in the new account's currency — the final
  // balance the account must hold after the import (the difference from the
  // imported rows' net is absorbed into `initialBalance`). `null` leaves the
  // balance at the imported rows' net sum. `.default(null)` keeps the wire
  // contract lenient (an omitted key still parses) while the parsed output is
  // `number | null`, matching the required-but-nullable `currentBalance` on the
  // shared `AccountMappingValue` create-new arm.
  z.object({
    action: z.literal('create-new'),
    currentBalance: boundedImportBalance({ label: 'Current balance' }).nullable().default(null),
  }),
  z.object({ action: z.literal('link-existing'), accountId: recordId() }),
  z.object({ action: z.literal('skip') }),
]);

export const categoryMappingValueSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create-new') }),
  z.object({ action: z.literal('link-existing'), categoryId: recordId() }),
]);

/**
 * Zod fragment for the fields every importer's execute request shares
 * (`ImportExecuteRequestBase` in the shared import-export types). Each
 * provider's execute controller spreads this into its own body schema so the
 * balance-recalculation contract is declared once instead of being hand-copied
 * per provider (where it could silently drift from the interface).
 */
export const importExecuteRequestBaseSchema = z.object({
  recalculateBalance: z.boolean().optional(),
});

/**
 * Compile-time drift guard: `importExecuteRequestBaseSchema` must infer exactly
 * `ImportExecuteRequestBase`. If a field is added to the shared interface but not
 * mirrored in this fragment (or vice versa), this line becomes a type error —
 * without it a new base field could reach the controllers without validation.
 *
 * @public exported only so the assertion isn't flagged as unused – nothing
 * should import it.
 */
export type ImportExecuteRequestBaseSchemaIsInSync = Expect<
  Equals<z.infer<typeof importExecuteRequestBaseSchema>, ImportExecuteRequestBase>
>;
