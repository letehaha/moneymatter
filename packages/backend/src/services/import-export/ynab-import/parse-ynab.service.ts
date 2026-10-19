import { detectDateColumnFormat } from '@bt/shared/import-export/date-engine';
import {
  YNAB_FLAG_COLORS,
  YNAB_MAX_REGISTER_ROWS,
  YNAB_READY_TO_ASSIGN_CATEGORY,
  YNAB_STARTING_BALANCE_PAYEE,
  YNAB_TRANSFER_PAYEE_PREFIX,
  type YnabFlagColor,
  type YnabParseAccount,
  type YnabParseCategory,
  type YnabParsePayee,
  type YnabParseResult,
  type YnabParseTagUsage,
  type YnabParseTransaction,
  type YnabParseTransfer,
  type YnabParseWarning,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { roundCurrency } from '@services/import-export/core/round-currency';
import { parse } from 'csv-parse/sync';

import { detectYnabDecimalSeparator, parseYnabAmount } from './parse-amount';
import { hasAmbiguousDateFieldOrder, parseYnabDate } from './parse-date';

/** Headers we require to exist (case-sensitive — YNAB's are stable). */
const REQUIRED_HEADERS = [
  'Account',
  'Flag',
  'Date',
  'Payee',
  'Category Group/Category',
  'Category Group',
  'Category',
  'Memo',
  'Outflow',
  'Inflow',
] as const;

const FLAG_COLOR_SET = new Set<string>(YNAB_FLAG_COLORS);
const SPLIT_MEMO_PREFIX_RE = /^split\s*\(/i;

/** Raw classified row, internal to the parser. */
interface ClassifiedRow {
  rowIndex: number;
  date: string | null;
  accountName: string;
  flag: YnabFlagColor | null;
  payeeName: string;
  categoryGroup: string | null;
  categoryName: string | null;
  memo: string;
  /** Outflow > 0 → negative; Inflow > 0 → positive; both 0 → 0. */
  signedAmount: number;
  /** True when this row was YNAB's synthetic opening balance for the account. */
  isStartingBalance: boolean;
  /** When present, this row is a transfer leg and the value is the other
   *  account's display name as YNAB wrote it. */
  transferCounterpart: string | null;
}

/**
 * Top-level entry point. Takes the verbatim contents of a `Register.csv` from
 * a YNAB ZIP export and produces the structured preview the wizard renders.
 *
 * Pure function: no DB writes, no side effects. Safe to call twice (the
 * execute worker re-parses to avoid persisting an intermediate session).
 */
export function parseYnabRegister({ fileContent }: { fileContent: string }): YnabParseResult {
  if (typeof fileContent !== 'string' || fileContent.trim() === '') {
    throw new ValidationError({ message: t({ key: 'importExport.ynab.parse.fileEmpty' }) });
  }

  let records: Record<string, string>[];
  try {
    records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[];
  } catch {
    throw new ValidationError({ message: t({ key: 'importExport.ynab.parse.unparseable' }) });
  }

  if (records.length === 0) {
    throw new ValidationError({ message: t({ key: 'importExport.ynab.parse.noTransactions' }) });
  }

  if (records.length > YNAB_MAX_REGISTER_ROWS) {
    throw new ValidationError({
      message: t({
        key: 'importExport.ynab.parse.tooManyRows',
        variables: { rows: records.length, max: YNAB_MAX_REGISTER_ROWS },
      }),
    });
  }

  const firstRow = records[0]!;
  const missing = REQUIRED_HEADERS.filter((h) => !(h in firstRow));
  if (missing.length > 0) {
    throw new ValidationError({
      message: t({ key: 'importExport.ynab.parse.missingColumns', variables: { columns: missing.join(', ') } }),
    });
  }

  const warnings: YnabParseWarning[] = [];
  const classifiedRows: ClassifiedRow[] = [];

  // One budget = one date format and one currency format, so both are resolved
  // over the whole file before any row is read.
  const dateValues = records.map((record) => (record['Date'] ?? '').trim());
  const detectedDateFormat = detectDateColumnFormat({ values: dateValues, locale: 'en' });
  if (!detectedDateFormat.ok) {
    throw new ValidationError({
      message: t({ key: 'importExport.ynab.parse.mixedDateOrders' }),
    });
  }
  const { fieldOrder } = detectedDateFormat.format;

  if (hasAmbiguousDateFieldOrder({ values: dateValues })) {
    warnings.push({
      code: 'ambiguous-date-order',
      message: t({ key: 'importExport.ynab.warnings.ambiguousDateOrder' }),
    });
  }

  const decimalSeparator = detectYnabDecimalSeparator({
    values: records.flatMap((record) => [record['Outflow'], record['Inflow']]),
  });

  records.forEach((record, idx) => {
    // CSV row index that maps to the file's line number (header = line 1).
    const rowIndex = idx + 2;

    const accountName = (record['Account'] ?? '').trim();
    if (!accountName) {
      warnings.push({ rowIndex, code: 'row-skipped', message: t({ key: 'importExport.ynab.warnings.noAccount' }) });
      return;
    }

    const date = parseYnabDate({ raw: record['Date'], fieldOrder });
    if (!date) {
      warnings.push({
        rowIndex,
        code: 'unparseable-date',
        message: t({ key: 'importExport.ynab.warnings.unparseableDate', variables: { value: record['Date'] ?? '' } }),
      });
      return;
    }

    const outflowParsed = parseYnabAmount({ raw: record['Outflow'], decimalSeparator });
    const inflowParsed = parseYnabAmount({ raw: record['Inflow'], decimalSeparator });
    const outflowUnparseable = !!record['Outflow'] && outflowParsed === null;
    const inflowUnparseable = !!record['Inflow'] && inflowParsed === null;
    if (outflowUnparseable) {
      warnings.push({
        rowIndex,
        code: 'unparseable-amount',
        message: t({ key: 'importExport.ynab.warnings.unparseableOutflow', variables: { value: record['Outflow'] } }),
      });
    }
    if (inflowUnparseable) {
      warnings.push({
        rowIndex,
        code: 'unparseable-amount',
        message: t({ key: 'importExport.ynab.warnings.unparseableInflow', variables: { value: record['Inflow'] } }),
      });
    }
    // Skip the whole row when either side is junk — silently substituting 0
    // would import a wrong-amount transaction the user has no way to spot.
    if (outflowUnparseable || inflowUnparseable) return;

    const signedAmount = roundCurrency({ n: (inflowParsed ?? 0) - (outflowParsed ?? 0) });

    const payeeName = (record['Payee'] ?? '').trim();
    const categoryGroupRaw = (record['Category Group'] ?? '').trim();
    const categoryNameRaw = (record['Category'] ?? '').trim();
    const categoryGroup = categoryGroupRaw || null;
    const categoryName = categoryNameRaw || null;
    const memo = (record['Memo'] ?? '').trim();

    const flagRaw = (record['Flag'] ?? '').trim().toLowerCase();
    let flag: YnabFlagColor | null = null;
    if (flagRaw !== '') {
      if (FLAG_COLOR_SET.has(flagRaw)) {
        flag = flagRaw as YnabFlagColor;
      } else {
        warnings.push({
          rowIndex,
          code: 'unknown-flag',
          message: t({ key: 'importExport.ynab.warnings.unknownFlag', variables: { value: flagRaw } }),
        });
      }
    }

    const isStartingBalance =
      payeeName === YNAB_STARTING_BALANCE_PAYEE &&
      categoryGroupRaw + ': ' + categoryNameRaw === YNAB_READY_TO_ASSIGN_CATEGORY;

    const transferCounterpart = payeeName.startsWith(YNAB_TRANSFER_PAYEE_PREFIX)
      ? payeeName.slice(YNAB_TRANSFER_PAYEE_PREFIX.length).trim()
      : null;

    classifiedRows.push({
      rowIndex,
      date,
      accountName,
      flag,
      payeeName,
      categoryGroup,
      categoryName,
      memo,
      signedAmount,
      isStartingBalance,
      transferCounterpart,
    });
  });

  if (classifiedRows.length === 0) {
    const firstProblem = warnings.find((w) => w.rowIndex !== undefined);
    throw new ValidationError({
      message: firstProblem
        ? t({ key: 'importExport.ynab.parse.noUsableRowsWithProblem', variables: { problem: firstProblem.message } })
        : t({ key: 'importExport.ynab.parse.noUsableRows' }),
    });
  }

  const { transfers, transferRowIndices } = pairTransfers({ rows: classifiedRows, warnings });
  // Splits are surfaced informationally only — the executor imports each
  // child row as a standalone transaction. Proper split modeling (one parent
  // + ≤10 children, sums-to-total) is a follow-up.
  const detectedSplitCount = countSplitGroups({ rows: classifiedRows, excludedRowIndices: transferRowIndices });

  const transactions: YnabParseTransaction[] = classifiedRows
    .filter((r) => !r.isStartingBalance && !transferRowIndices.has(r.rowIndex))
    .map((r) => {
      const isReadyToAssign = r.categoryGroup === 'Inflow' && r.categoryName === 'Ready to Assign';
      return {
        rowIndex: r.rowIndex,
        date: r.date!,
        accountName: r.accountName,
        payeeName: r.payeeName,
        categoryGroup: isReadyToAssign ? null : r.categoryGroup,
        categoryName: isReadyToAssign ? null : r.categoryName,
        memo: r.memo,
        amount: r.signedAmount,
        flag: r.flag,
      };
    });

  const accounts = collectAccounts({ rows: classifiedRows, warnings });
  const categories = collectCategories({ transactions });
  const payees = collectPayees({ transactions });
  const tagsUsed = collectTagsUsed({ transactions, transfers });
  const dateRange = computeDateRange({ rows: classifiedRows });

  return {
    accounts,
    categories,
    payees,
    tagsUsed,
    transactions,
    transfers,
    detectedSplitCount,
    warnings,
    dateRange,
  };
}

/** Walk transfer-leg rows and pair them. The first unmatched opposite leg of
 *  matching amount + date wins; remaining unpaired legs become warnings and
 *  fall through to ordinary transactions. */
function pairTransfers({ rows, warnings }: { rows: ClassifiedRow[]; warnings: YnabParseWarning[] }): {
  transfers: YnabParseTransfer[];
  transferRowIndices: Set<number>;
} {
  const legs = rows.filter((r) => r.transferCounterpart !== null);
  const used = new Set<number>();
  const transfers: YnabParseTransfer[] = [];

  for (const leg of legs) {
    if (used.has(leg.rowIndex)) continue;
    if (leg.signedAmount >= 0) continue; // Only iterate from the outflow side.

    const match = legs.find(
      (other) =>
        !used.has(other.rowIndex) &&
        other.rowIndex !== leg.rowIndex &&
        other.date === leg.date &&
        other.accountName === leg.transferCounterpart &&
        leg.accountName === other.transferCounterpart &&
        roundCurrency({ n: other.signedAmount + leg.signedAmount }) === 0,
    );

    if (!match) {
      warnings.push({
        rowIndex: leg.rowIndex,
        code: 'transfer-counterpart-missing',
        message: t({
          key: 'importExport.ynab.warnings.transferNoInflow',
          variables: { account: leg.transferCounterpart },
        }),
      });
      continue;
    }

    used.add(leg.rowIndex);
    used.add(match.rowIndex);

    transfers.push({
      sourceAccountName: leg.accountName,
      destinationAccountName: match.accountName,
      date: leg.date!,
      amount: Math.abs(leg.signedAmount),
      memo: leg.memo || match.memo,
      flag: leg.flag ?? match.flag,
      rowIndices: [leg.rowIndex, match.rowIndex],
    });
  }

  // Inflow-side leg with no matching outflow → also a warning.
  for (const leg of legs) {
    if (used.has(leg.rowIndex) || leg.signedAmount < 0) continue;
    warnings.push({
      rowIndex: leg.rowIndex,
      code: 'transfer-counterpart-missing',
      message: t({
        key: 'importExport.ynab.warnings.transferNoOutflow',
        variables: { account: leg.transferCounterpart },
      }),
    });
  }

  return { transfers, transferRowIndices: used };
}

/** Best-effort heuristic: consecutive same-(date, account, payee) rows where
 *  every memo opens with `Split (` count as one split group. Anything else
 *  falls through to standalone transactions. Surfaced honestly so users can
 *  fix up rare misses post-import. */
function countSplitGroups({
  rows,
  excludedRowIndices,
}: {
  rows: ClassifiedRow[];
  excludedRowIndices: Set<number>;
}): number {
  let count = 0;

  let group: ClassifiedRow[] = [];
  const flushGroup = () => {
    if (group.length < 2) return;
    if (group.every((r) => SPLIT_MEMO_PREFIX_RE.test(r.memo))) count += 1;
  };

  for (const row of rows) {
    if (row.isStartingBalance || excludedRowIndices.has(row.rowIndex)) {
      flushGroup();
      group = [];
      continue;
    }
    if (group.length === 0) {
      group.push(row);
      continue;
    }
    const head = group[0]!;
    if (head.date === row.date && head.accountName === row.accountName && head.payeeName === row.payeeName) {
      group.push(row);
    } else {
      flushGroup();
      group = [row];
    }
  }
  flushGroup();

  return count;
}

function collectAccounts({
  rows,
  warnings,
}: {
  rows: ClassifiedRow[];
  warnings: YnabParseWarning[];
}): YnabParseAccount[] {
  const byName = new Map<string, { startingBalance: number; transactionCount: number }>();

  for (const row of rows) {
    const existing = byName.get(row.accountName) ?? { startingBalance: 0, transactionCount: 0 };
    if (row.isStartingBalance) {
      existing.startingBalance = roundCurrency({ n: existing.startingBalance + row.signedAmount });
    } else {
      existing.transactionCount += 1;
    }
    byName.set(row.accountName, existing);
  }

  return Array.from(byName.entries()).map(([originalName, agg]) => {
    const detectedCurrency = detectCurrencyFromAccountName(originalName);
    if (!detectedCurrency) {
      warnings.push({
        code: 'currency-undetected',
        message: t({ key: 'importExport.ynab.warnings.currencyUndetected', variables: { account: originalName } }),
      });
    }
    return {
      originalName,
      detectedCurrency,
      startingBalance: agg.startingBalance,
      transactionCount: agg.transactionCount,
    };
  });
}

const CURRENCY_RE = /\(([A-Z]{3})\)/;

function detectCurrencyFromAccountName(name: string): string | null {
  const match = name.match(CURRENCY_RE);
  return match ? match[1]! : null;
}

export function collectCategories({ transactions }: { transactions: YnabParseTransaction[] }): YnabParseCategory[] {
  const byKey = new Map<string, YnabParseCategory>();

  for (const t of transactions) {
    if (!t.categoryGroup || !t.categoryName) continue;
    const fullName = `${t.categoryGroup}: ${t.categoryName}`;
    const existing = byKey.get(fullName);
    if (existing) {
      existing.transactionCount += 1;
    } else {
      byKey.set(fullName, {
        groupName: t.categoryGroup,
        categoryName: t.categoryName,
        fullName,
        transactionCount: 1,
      });
    }
  }

  return Array.from(byKey.values()).toSorted((a, b) =>
    a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }),
  );
}

export function collectPayees({ transactions }: { transactions: YnabParseTransaction[] }): YnabParsePayee[] {
  const byName = new Map<string, number>();

  for (const t of transactions) {
    const name = t.payeeName;
    if (!name) continue;
    if (name === YNAB_STARTING_BALANCE_PAYEE) continue;
    if (name.startsWith(YNAB_TRANSFER_PAYEE_PREFIX)) continue;
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }

  return Array.from(byName.entries())
    .map(([name, transactionCount]) => ({ name, transactionCount }))
    .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function collectTagsUsed({
  transactions,
  transfers,
}: {
  transactions: YnabParseTransaction[];
  transfers: YnabParseTransfer[];
}): YnabParseTagUsage[] {
  const byColor = new Map<YnabFlagColor, number>();
  const incr = (flag: YnabFlagColor | null) => {
    if (!flag) return;
    byColor.set(flag, (byColor.get(flag) ?? 0) + 1);
  };
  for (const t of transactions) incr(t.flag);
  for (const t of transfers) incr(t.flag);
  return YNAB_FLAG_COLORS.filter((c) => byColor.has(c)).map((color) => ({
    color,
    transactionCount: byColor.get(color)!,
  }));
}

function computeDateRange({ rows }: { rows: ClassifiedRow[] }): { from: string; to: string } | null {
  let min: string | null = null;
  let max: string | null = null;
  for (const r of rows) {
    if (!r.date) continue;
    if (min === null || r.date < min) min = r.date;
    if (max === null || r.date > max) max = r.date;
  }
  if (!min || !max) return null;
  return { from: min, to: max };
}
