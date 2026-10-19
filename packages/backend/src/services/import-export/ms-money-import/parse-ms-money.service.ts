/**
 * Reads a Microsoft Money (.mny) database into the importer's parse result.
 *
 * Money keeps its ledger in a handful of tables:
 *   ACCT       accounts
 *   TRN        every transaction row, including split lines
 *   TRN_SPLIT  links split lines to their parent row
 *   TRN_XFER   links the two legs of a transfer
 *   CAT        two-level categories under fixed INCOME/EXPENSE roots
 *   PAY        payees
 *   CRNC       currencies
 *
 * Three of those relationships decide what actually gets imported:
 *
 *  - A split is stored as a parent row holding the total plus child rows holding
 *    the per-category detail. The parent carries no category, so the children are
 *    imported as individual transactions and the parent is dropped — importing
 *    both would double the amount.
 *  - A transfer is stored as two mirrored rows, joined by TRN_XFER. Only one
 *    transfer is emitted per pair; importing each row on its own would double
 *    every transfer.
 *  - A voided row keeps its amount but sets bit 21 of `grftt`. Money shows it in
 *    the register yet never applies it to the balance, so it is emitted at
 *    amount 0 with `isVoid` set and the original kept in `voidedAmount`. Voided
 *    rows never pair into transfers — each leg stands alone.
 */
import {
  MS_MONEY_MAX_ROWS,
  MS_MONEY_SUPPORTED_ACCOUNT_TYPES,
  type MsMoneyAccountType,
  type MsMoneyParseAccount,
  type MsMoneyParseCategory,
  type MsMoneyParsePayee,
  type MsMoneyParseResult,
  type MsMoneyParseTransaction,
  type MsMoneyParseTransfer,
  type MsMoneyParseWarning,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { requestContext } from '@common/request-context';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import MDBReader from 'mdb-reader';

import { decryptMsisam } from './decrypt-msisam';

/** Bit 21 of `TRN.grftt` marks a row voided in Money. */
const VOID_FLAG = 0x200000;

/** Money writes -1 rather than null for "no payee". */
const NO_PAYEE = -1;

/** `TRN.cs` — Money's cleared state. 2 means reconciled against a statement. */
const CLEARED_STATE_RECONCILED = 2;

export interface AcctRow {
  hacct: number;
  szFull: string | null;
  at: number | null;
  hcrnc: number | null;
}
interface TrnRow {
  htrn: number;
  hacct: number | null;
  /** Counterpart account when the row is one leg of a transfer. */
  hacctLink: number | null;
  dt: Date | null;
  amt: string | number | null;
  hcat: number | null;
  lHpay: number | null;
  mMemo: string | null;
  szId: string | null;
  cs: number | null;
  grftt: number | null;
}
interface CatRow {
  hcat: number;
  szFull: string | null;
  hcatParent: number | null;
  nLevel: number | null;
}

/**
 * Money stores amounts in a fixed-point currency column; the reader hands them
 * back as decimal strings to avoid float drift. Null means the column held
 * nothing readable — the row is skipped rather than imported at 0, which would
 * post a real transaction that moves none of the money the row carried.
 */
export function readAmount({ value }: { value: string | number | null | undefined }): number | null {
  if (value == null) return null;
  // `Number('')` is 0, so an empty cell has to be rejected before the cast.
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Money dates are plain calendar days; anchor them to UTC midnight. */
function toIsoDate({ value }: { value: Date | null | undefined }): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

const SUPPORTED_ACCOUNT_TYPES = new Set<number>(MS_MONEY_SUPPORTED_ACCOUNT_TYPES);

/** Written as a type guard so `ACCT.at` reaches `MsMoneyParseAccount.accountType`
 *  as a checked value rather than a cast. */
function isSupportedAccountType(value: number | null | undefined): value is MsMoneyAccountType {
  return value != null && SUPPORTED_ACCOUNT_TYPES.has(value);
}

/** A table or column this parser asked for that the file does not hold. */
interface SchemaGap {
  table: string;
  /** True when the table itself is absent. */
  tableMissing: boolean;
  /** Requested columns the table does not hold. Empty when the table is absent. */
  missingColumns: string[];
}

/**
 * Reads Money's tables and records anything asked for that the file does not
 * hold. Money's schema varies across versions, and a silently absent table or
 * column empties a whole part of the import — TRN_XFER turns every transfer into
 * two loose legs, `grftt` makes voided cheques look real.
 */
function createTableReader({ reader }: { reader: MDBReader }) {
  const tableNames = new Set(reader.getTableNames());
  const gaps: SchemaGap[] = [];

  const read = <T>({ name, columns }: { name: string; columns?: string[] }): T[] => {
    if (!tableNames.has(name)) {
      gaps.push({ table: name, tableMissing: true, missingColumns: [] });
      return [];
    }

    const table = reader.getTable(name);
    const available = new Set(table.getColumnNames());
    const missingColumns = columns?.filter((column) => !available.has(column)) ?? [];
    if (missingColumns.length) gaps.push({ table: name, tableMissing: false, missingColumns });

    const wanted = columns?.filter((column) => available.has(column));
    return table.getData({ ...(wanted?.length ? { columns: wanted } : {}) }) as T[];
  };

  return { read, gaps };
}

/** Names the tables and columns the file lacks, so an operator can tell which
 *  Money variant produced an incomplete import. */
export function describeSchemaGaps({ gaps }: { gaps: SchemaGap[] }): string {
  const details = gaps
    .map((gap) =>
      gap.tableMissing
        ? t({ key: 'importExport.msMoney.schemaGapTableMissing', variables: { table: gap.table } })
        : t({
            key: 'importExport.msMoney.schemaGapColumnsMissing',
            variables: { table: gap.table, columns: gap.missingColumns.join(', ') },
          }),
    )
    .join('; ');

  return t({ key: 'importExport.msMoney.warnings.fileSchemaUnexpected', variables: { details } });
}

interface AccountIndex {
  accountById: Map<number, MsMoneyParseAccount>;
  /** Every id in ACCT, so a transaction pointing at a missing account can be
   *  told apart from one on an account this importer skipped. */
  knownAcctIds: Set<number>;
  unsupportedAccounts: number;
  defaultedCurrencies: number;
  synthesizedNames: number;
  duplicateNames: number;
}

/**
 * Turns ACCT rows into the accounts the import works with. Everything after the
 * parser is keyed by `originalName`, so a nameless account gets a placeholder
 * and a repeated name gets numbered — otherwise the rows either vanish or merge
 * into one account carrying both balances.
 */
export function buildAccountIndex({
  rows,
  currencyById,
  fallbackCurrency,
}: {
  rows: AcctRow[];
  currencyById: Map<number, string>;
  fallbackCurrency: string;
}): AccountIndex {
  const accountById = new Map<number, MsMoneyParseAccount>();
  const knownAcctIds = new Set<number>();
  const usedNames = new Set<string>();
  let unsupportedAccounts = 0;
  let defaultedCurrencies = 0;
  let synthesizedNames = 0;
  let duplicateNames = 0;

  for (const row of rows) {
    knownAcctIds.add(row.hacct);

    if (!isSupportedAccountType(row.at)) {
      unsupportedAccounts += 1;
      continue;
    }

    let name = row.szFull?.trim();
    if (!name) {
      name = `Account ${row.hacct}`;
      synthesizedNames += 1;
    }

    let originalName = name;
    if (usedNames.has(originalName)) {
      duplicateNames += 1;
      let suffix = 2;
      while (usedNames.has(`${name} (${suffix})`)) suffix += 1;
      originalName = `${name} (${suffix})`;
    }
    usedNames.add(originalName);

    const currency = (row.hcrnc == null ? undefined : currencyById.get(row.hcrnc)) ?? null;
    if (!currency) defaultedCurrencies += 1;

    accountById.set(row.hacct, {
      originalName,
      currency: currency ?? fallbackCurrency,
      currencyDefaulted: !currency,
      accountType: row.at,
      transactionCount: 0,
      netImportedAmount: 0,
    });
  }

  return { accountById, knownAcctIds, unsupportedAccounts, defaultedCurrencies, synthesizedNames, duplicateNames };
}

/**
 * Builds each category's display path. Money nests categories two deep beneath
 * fixed INCOME and EXPENSE roots, so a leaf renders as `"Group:Leaf"` while a
 * group renders as its own name. The roots themselves are structural and are
 * never offered as categories.
 */
function buildCategoryIndex({ rows }: { rows: CatRow[] }) {
  const byId = new Map(rows.map((row) => [row.hcat, row]));
  const index = new Map<number, { fullName: string; name: string; groupName: string | null }>();

  for (const row of rows) {
    const name = row.szFull?.trim();
    // Level 0 holds the INCOME/EXPENSE roots — structural, never user-facing.
    if (!name || row.nLevel === 0) continue;

    const parent = row.hcatParent == null ? undefined : byId.get(row.hcatParent);
    const groupName = parent && parent.nLevel !== 0 ? (parent.szFull?.trim() ?? null) : null;

    index.set(row.hcat, {
      fullName: groupName ? `${groupName}:${name}` : name,
      name,
      groupName,
    });
  }

  return index;
}

export function parseMsMoneyFile({
  buffer,
  password = null,
  fallbackCurrency,
}: {
  buffer: Buffer;
  password?: string | null;
  /** Currency given to accounts the file carries none for. */
  fallbackCurrency: string;
}): MsMoneyParseResult {
  const { buffer: plaintext, encryption } = decryptMsisam({ buffer, password });

  let reader: MDBReader;
  try {
    reader = new MDBReader(plaintext);
  } catch {
    throw new ValidationError({ message: t({ key: 'importExport.msMoney.unreadableFile' }) });
  }

  // Without these two the parser would return an empty result and no warnings,
  // walking the user through a wizard that imports nothing.
  const tableNames = new Set(reader.getTableNames());
  if (!tableNames.has('ACCT') || !tableNames.has('TRN')) {
    throw new ValidationError({ message: t({ key: 'importExport.msMoney.missingTables' }) });
  }

  const warnings: MsMoneyParseWarning[] = [];
  const addWarning = ({ code, message, count }: MsMoneyParseWarning) => {
    if (count > 0) warnings.push({ code, message, count });
  };

  const tables = createTableReader({ reader });

  // --- currencies -----------------------------------------------------------
  const currencyById = new Map<number, string>();
  for (const row of tables.read<{ hcrnc: number; szIsoCode: string | null }>({
    name: 'CRNC',
    columns: ['hcrnc', 'szIsoCode'],
  })) {
    const code = row.szIsoCode?.trim().toUpperCase();
    if (code) currencyById.set(row.hcrnc, code);
  }

  // --- accounts -------------------------------------------------------------
  const { accountById, knownAcctIds, unsupportedAccounts, defaultedCurrencies, synthesizedNames, duplicateNames } =
    buildAccountIndex({
      rows: tables.read<AcctRow>({ name: 'ACCT', columns: ['hacct', 'szFull', 'at', 'hcrnc'] }),
      currencyById,
      fallbackCurrency,
    });

  addWarning({
    code: 'account-type-unsupported',
    message: t({ key: 'importExport.msMoney.warnings.accountTypeUnsupported' }),
    count: unsupportedAccounts,
  });
  addWarning({
    code: 'account-currency-defaulted',
    message: t({ key: 'importExport.msMoney.warnings.accountCurrencyDefaulted' }),
    count: defaultedCurrencies,
  });
  addWarning({
    code: 'account-name-missing',
    message: t({ key: 'importExport.msMoney.warnings.accountNameMissing' }),
    count: synthesizedNames,
  });
  addWarning({
    code: 'account-name-duplicated',
    message: t({ key: 'importExport.msMoney.warnings.accountNameDuplicated' }),
    count: duplicateNames,
  });

  // --- lookups --------------------------------------------------------------
  const categoryIndex = buildCategoryIndex({
    rows: tables.read<CatRow>({ name: 'CAT', columns: ['hcat', 'szFull', 'hcatParent', 'nLevel'] }),
  });

  const payeeById = new Map<number, string>();
  for (const row of tables.read<{ hpay: number; szFull: string | null }>({
    name: 'PAY',
    columns: ['hpay', 'szFull'],
  })) {
    const name = row.szFull?.trim();
    if (name) payeeById.set(row.hpay, name);
  }

  // Split children are imported individually; their parents only hold the total.
  const splitParentIds = new Set<number>();
  const splitChildIds = new Set<number>();
  for (const row of tables.read<{ htrn: number | null; htrnParent: number | null }>({
    name: 'TRN_SPLIT',
    columns: ['htrn', 'htrnParent'],
  })) {
    if (row.htrnParent != null) splitParentIds.add(row.htrnParent);
    if (row.htrn != null) splitChildIds.add(row.htrn);
  }

  // --- transactions ---------------------------------------------------------
  const trnRows = tables.read<TrnRow>({
    name: 'TRN',
    columns: ['htrn', 'hacct', 'hacctLink', 'dt', 'amt', 'hcat', 'lHpay', 'mMemo', 'szId', 'cs', 'grftt'],
  });
  const trnById = new Map(trnRows.map((row) => [row.htrn, row]));

  let orphanRows = 0;

  /** Rows that survive filtering and are eligible to become transactions. */
  const eligible: TrnRow[] = [];
  /** Voided rows on importable accounts. Held apart from `eligible` so they are
   *  invisible to the transfer loop: a voided pair stays two standalone rows. */
  const voided: TrnRow[] = [];
  for (const row of trnRows) {
    if (splitParentIds.has(row.htrn)) continue;

    const onImportableAccount = row.hacct != null && accountById.has(row.hacct);

    if ((row.grftt ?? 0) & VOID_FLAG) {
      // A voided row on an account this importer skipped has nowhere to land;
      // the account-type warning already accounts for it.
      if (onImportableAccount) voided.push(row);
      continue;
    }
    if (!onImportableAccount) {
      // A row on an account this importer skipped is already covered by the
      // account-type warning, so only a reference ACCT cannot resolve is an orphan.
      if (row.hacct == null || !knownAcctIds.has(row.hacct)) orphanRows += 1;
      continue;
    }
    eligible.push(row);
  }

  const eligibleIds = new Set(eligible.map((row) => row.htrn));

  /** Both loops below already filtered to importable accounts, so a miss here
   *  means the file contradicts itself — the row is skipped, not crashed on. */
  const accountFor = ({ row }: { row: TrnRow }) => (row.hacct == null ? undefined : accountById.get(row.hacct));

  // --- emitted rows ---------------------------------------------------------
  // Transfers and transactions draw on one shared row budget, so a file made
  // mostly of transfers cannot spend the whole allowance before the transaction
  // loop starts.
  const transactions: MsMoneyParseTransaction[] = [];
  const transfers: MsMoneyParseTransfer[] = [];
  const categoryCounts = new Map<string, number>();
  const payeeCounts = new Map<string, number>();
  let droppedForRowLimit = 0;
  let datelessRows = 0;
  let unreadableAmountRows = 0;
  const rowBudgetLeft = () => transactions.length + transfers.length < MS_MONEY_MAX_ROWS;

  // --- transfers ------------------------------------------------------------
  // Money links the two legs explicitly, so no amount/date matching is needed.
  const consumedByTransfer = new Set<number>();
  const rowIndexById = new Map<number, number>();
  let nextRowIndex = 0;
  const claimRowIndex = (htrn: number) => {
    const existing = rowIndexById.get(htrn);
    if (existing !== undefined) return existing;
    const index = nextRowIndex++;
    rowIndexById.set(htrn, index);
    return index;
  };

  for (const link of tables.read<{ htrnFrom: number | null; htrnLink: number | null }>({
    name: 'TRN_XFER',
    columns: ['htrnFrom', 'htrnLink'],
  })) {
    if (link.htrnFrom == null || link.htrnLink == null) continue;

    const first = trnById.get(link.htrnFrom);
    const second = trnById.get(link.htrnLink);
    if (!first || !second) continue;

    const firstEligible = eligibleIds.has(first.htrn);
    const secondEligible = eligibleIds.has(second.htrn);

    // When only one side is being imported the pair cannot become a transfer;
    // the surviving leg falls through to the transaction loop, which imports it
    // as money leaving/entering the tracked accounts.
    if (!firstEligible || !secondEligible) continue;

    // The leg with the negative amount is the source; Money always signs the two
    // legs opposite to each other. An unreadable amount drops the pair a few
    // lines down, so which leg it picks in that case does not matter.
    const firstAmount = readAmount({ value: first.amt });
    const secondAmount = readAmount({ value: second.amt });
    const firstIsSource = (firstAmount ?? 0) <= 0;
    const source = firstIsSource ? first : second;
    const destination = firstIsSource ? second : first;
    const sourceAmount = firstIsSource ? firstAmount : secondAmount;
    const destinationAmount = firstIsSource ? secondAmount : firstAmount;

    // Claimed before the drop checks below, so a pair this loop gives up on is
    // never re-counted as two loose rows by the transaction loop.
    consumedByTransfer.add(source.htrn);
    consumedByTransfer.add(destination.htrn);

    // A dropped pair costs the user two rows, so every count below moves in twos
    // and stays comparable with the per-row counts the transaction loop keeps.
    const sourceAccount = accountFor({ row: source });
    const destinationAccount = accountFor({ row: destination });
    if (!sourceAccount || !destinationAccount) {
      orphanRows += 2;
      continue;
    }

    const date = toIsoDate({ value: source.dt }) ?? toIsoDate({ value: destination.dt });
    if (!date) {
      datelessRows += 2;
      continue;
    }
    if (sourceAmount == null || destinationAmount == null) {
      unreadableAmountRows += 2;
      continue;
    }
    if (!rowBudgetLeft()) {
      droppedForRowLimit += 2;
      continue;
    }

    const payeeId = source.lHpay ?? destination.lHpay;
    const payeeName = payeeId != null && payeeId !== NO_PAYEE ? (payeeById.get(payeeId) ?? null) : null;

    transfers.push({
      sourceAccountName: sourceAccount.originalName,
      destinationAccountName: destinationAccount.originalName,
      date,
      sourceAmount: Math.abs(sourceAmount),
      destinationAmount: Math.abs(destinationAmount),
      sourceCurrency: sourceAccount.currency,
      destinationCurrency: destinationAccount.currency,
      note: source.mMemo?.trim() || destination.mMemo?.trim() || '',
      payeeName,
      rowIndices: [claimRowIndex(source.htrn), claimRowIndex(destination.htrn)],
      sourceIds: [source.htrn, destination.htrn],
    });

    if (payeeName) payeeCounts.set(payeeName, (payeeCounts.get(payeeName) ?? 0) + 1);

    sourceAccount.transactionCount += 1;
    sourceAccount.netImportedAmount -= Math.abs(sourceAmount);
    destinationAccount.transactionCount += 1;
    destinationAccount.netImportedAmount += Math.abs(destinationAmount);
  }

  // --- remaining rows become transactions -----------------------------------
  // Voided rows come last so the row indices of ordinary rows do not shift.
  const rowsToEmit = [
    ...eligible.map((row) => ({ row, isVoid: false })),
    ...voided.map((row) => ({ row, isVoid: true })),
  ];

  for (const { row, isVoid } of rowsToEmit) {
    if (consumedByTransfer.has(row.htrn)) continue;

    // Same guard order as the transfer loop, so the counts the two produce mean
    // the same thing.
    const account = accountFor({ row });
    if (!account) {
      orphanRows += 1;
      continue;
    }

    const date = toIsoDate({ value: row.dt });
    if (!date) {
      datelessRows += 1;
      continue;
    }

    const rawAmount = readAmount({ value: row.amt });
    if (rawAmount == null) {
      unreadableAmountRows += 1;
      continue;
    }

    if (!rowBudgetLeft()) {
      droppedForRowLimit += 1;
      continue;
    }

    // Money never applies a voided row to the balance, so it is emitted at zero
    // and the amount it carried moves to `voidedAmount`.
    const amount = isVoid ? 0 : rawAmount;
    const category = row.hcat == null ? undefined : categoryIndex.get(row.hcat);
    const payeeName = row.lHpay != null && row.lHpay !== NO_PAYEE ? (payeeById.get(row.lHpay) ?? null) : null;

    // Rows paired into a transfer were skipped above, so a counterpart account
    // still set here means the other side is not part of this import. A voided
    // leg is never that case: both legs of a voided pair are emitted here, and
    // at zero neither moves money out of the tracked accounts.
    const outOfWallet = !isVoid && row.hacctLink != null;

    transactions.push({
      rowIndex: claimRowIndex(row.htrn),
      sourceId: row.htrn,
      date,
      accountName: account.originalName,
      categoryName: outOfWallet ? null : (category?.fullName ?? null),
      payeeName,
      note: row.mMemo?.trim() ?? '',
      amount,
      // Direction is read from the amount the row carried, not from `amount`:
      // a voided row is zeroed above and would otherwise all land on income.
      // A genuine zero-amount row carries no sign either, so it lands on income.
      type: rawAmount < 0 ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
      referenceNumber: row.szId?.trim() || null,
      reconciled: row.cs === CLEARED_STATE_RECONCILED,
      outOfWallet,
      fromSplit: splitChildIds.has(row.htrn),
      isVoid,
      voidedAmount: isVoid ? rawAmount : null,
    });

    account.transactionCount += 1;
    account.netImportedAmount += amount;

    if (!outOfWallet && category) {
      categoryCounts.set(category.fullName, (categoryCounts.get(category.fullName) ?? 0) + 1);
    }
    if (payeeName) payeeCounts.set(payeeName, (payeeCounts.get(payeeName) ?? 0) + 1);
  }

  // Counted from the rows that were actually emitted, so the number the user
  // reads always matches the transactions in the preview.
  addWarning({
    code: 'transfer-counterpart-not-imported',
    message: t({ key: 'importExport.msMoney.warnings.transferCounterpartNotImported' }),
    count: transactions.filter((transaction) => transaction.outOfWallet).length,
  });

  addWarning({
    code: 'row-limit-reached',
    message: t({
      key: 'importExport.msMoney.warnings.rowLimitReached',
      variables: { max: MS_MONEY_MAX_ROWS.toLocaleString(requestContext.getLocale()) },
    }),
    count: droppedForRowLimit,
  });

  addWarning({
    code: 'row-missing-date',
    message: t({ key: 'importExport.msMoney.warnings.rowMissingDate' }),
    count: datelessRows,
  });

  addWarning({
    code: 'row-amount-unreadable',
    message: t({ key: 'importExport.msMoney.warnings.rowAmountUnreadable' }),
    count: unreadableAmountRows,
  });

  addWarning({
    code: 'orphan-row-skipped',
    message: t({ key: 'importExport.msMoney.warnings.orphanRowSkipped' }),
    count: orphanRows,
  });

  addWarning({
    code: 'file-schema-unexpected',
    message: describeSchemaGaps({ gaps: tables.gaps }),
    count: tables.gaps.length,
  });

  // --- aggregates -----------------------------------------------------------
  const categories: MsMoneyParseCategory[] = [];
  for (const entry of categoryIndex.values()) {
    const transactionCount = categoryCounts.get(entry.fullName);
    if (transactionCount) categories.push({ ...entry, transactionCount });
  }
  categories.sort((a, b) => a.fullName.localeCompare(b.fullName));

  const payees: MsMoneyParsePayee[] = [...payeeCounts.entries()]
    .map(([name, transactionCount]) => ({ name, transactionCount }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const accounts = [...accountById.values()]
    .filter((account) => account.transactionCount > 0)
    .sort((a, b) => a.originalName.localeCompare(b.originalName));

  // Voided rows are excluded: the execute step converts new-account starting
  // balances at `dateRange.from`, and a decade-old voided cheque would drag that
  // FX reference date back for an import that never writes the row.
  const allDates = [
    ...transactions.filter((tx) => !tx.isVoid).map((tx) => tx.date),
    ...transfers.map((transfer) => transfer.date),
  ].sort();
  const dateRange = allDates.length ? { from: allDates[0]!, to: allDates[allDates.length - 1]! } : null;

  // Money has no single "base currency" field, so the most-used account
  // currency stands in for it. Never used for maths.
  const currencyUse = new Map<string, number>();
  for (const account of accounts) {
    currencyUse.set(account.currency, (currencyUse.get(account.currency) ?? 0) + account.transactionCount);
  }
  const baseCurrency = [...currencyUse.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    accounts,
    categories,
    payees,
    transactions,
    transfers,
    warnings,
    dateRange,
    baseCurrency,
    encryption,
  };
}
