import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { createHash } from 'node:crypto';

import { parseOfxAmount } from './amount';
import { parseOfxDate } from './date';
import type { OfxNode } from './syntax';
import {
  OFX_MAX_ROWS,
  OfxParseError,
  type OfxFormatVersion,
  type OfxParseAccount,
  type OfxParseResult,
  type OfxParseTransaction,
  type OfxParseWarning,
  type OfxStatementType,
} from './types';

type Node = Record<string, unknown>;

interface RawStatement {
  node: Node;
  type: OfxStatementType;
}

const CREDIT_TYPES = new Set(['CREDIT', 'DIRECTDEP', 'DIV', 'INT']);
const PAYEE_NAME_MAX_LENGTH = 200;
const TRANSACTION_NOTE_MAX_LENGTH = 2_000;

function boundedText({ value, field, maxLength }: { value: string | undefined; field: string; maxLength: number }) {
  if (value && value.length > maxLength) {
    throw new OfxParseError({
      code: 'text-too-long',
      key: 'ofxImport.errors.textTooLong',
      params: { field, max: maxLength },
    });
  }
  return value;
}

function objectValue({ value }: { value: unknown }): Node | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : null;
}

function stringValue({ node, key }: { node: Node; key: string }): string | undefined {
  const value = node[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayValue<T>({ value }: { value: T | T[] | undefined }): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function digest({ parts }: { parts: Array<string | undefined> }): string {
  return createHash('sha256')
    .update(parts.map((part) => part ?? '').join('\0'))
    .digest('hex');
}

function getFinancialInstitution({ ofx }: { ofx: Node }): { fid?: string; name?: string; org?: string } {
  const signOn = objectValue({ value: ofx.SIGNONMSGSRSV1 });
  const response = signOn && objectValue({ value: signOn.SONRS });
  const fi = response && objectValue({ value: response.FI });
  return fi
    ? {
        fid: stringValue({ node: fi, key: 'FID' }),
        name: stringValue({ node: fi, key: 'ORG' }),
        org: stringValue({ node: fi, key: 'ORG' }),
      }
    : {};
}

function collectStatements({ ofx }: { ofx: Node }): RawStatement[] {
  const statements: RawStatement[] = [];
  const bankSet = objectValue({ value: ofx.BANKMSGSRSV1 });
  const cardSet = objectValue({ value: ofx.CREDITCARDMSGSRSV1 });

  for (const wrapperValue of arrayValue({ value: bankSet?.STMTTRNRS })) {
    const wrapper = objectValue({ value: wrapperValue });
    const statement = wrapper && objectValue({ value: wrapper.STMTRS });
    if (statement) statements.push({ node: statement, type: 'bank' });
  }
  for (const wrapperValue of arrayValue({ value: cardSet?.CCSTMTTRNRS })) {
    const wrapper = objectValue({ value: wrapperValue });
    const statement = wrapper && objectValue({ value: wrapper.CCSTMTRS });
    if (statement) statements.push({ node: statement, type: 'credit-card' });
  }

  if (statements.length === 0) {
    throw new OfxParseError({ code: 'unsupported-message-set', key: 'ofxImport.errors.unsupportedMessageSet' });
  }
  return statements;
}

function accountIdentity({ fi, statement }: { fi: { fid?: string; org?: string }; statement: RawStatement }) {
  const accountTag = statement.type === 'bank' ? 'BANKACCTFROM' : 'CCACCTFROM';
  const account = objectValue({ value: statement.node[accountTag] });
  if (!account)
    throw new OfxParseError({
      code: 'missing-account',
      key: 'ofxImport.errors.missingAccount',
      params: { tag: accountTag },
    });
  const accountId = stringValue({ node: account, key: 'ACCTID' });
  if (!accountId) throw new OfxParseError({ code: 'missing-account-id', key: 'ofxImport.errors.missingAccountId' });
  return {
    accountId,
    accountType:
      stringValue({ node: account, key: 'ACCTTYPE' }) ?? (statement.type === 'credit-card' ? 'CREDITCARD' : 'CHECKING'),
    bankId: stringValue({ node: account, key: 'BANKID' }),
    branchId: stringValue({ node: account, key: 'BRANCHID' }),
    // Use a digest in API data so raw account identifiers do not leave the
    // parser. All fields that can distinguish two source accounts are included.
    sourceAccountKey: digest({
      parts: [
        fi.org,
        fi.fid,
        statement.type,
        stringValue({ node: account, key: 'BANKID' }),
        stringValue({ node: account, key: 'BRANCHID' }),
        accountId,
        stringValue({ node: account, key: 'ACCTTYPE' }),
      ],
    }),
  };
}

function transactionSignature({ transaction }: { transaction: Node }): string {
  const entries = Object.entries(transaction).toSorted(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function mapTransaction({
  accountIdentityValue,
  fi,
  raw,
  rowIndex,
  warnings,
  timezone,
}: {
  accountIdentityValue: ReturnType<typeof accountIdentity>;
  fi: { fid?: string; org?: string };
  raw: Node;
  rowIndex: number;
  warnings: Map<OfxParseWarning['code'], number>;
  timezone?: string;
}): OfxParseTransaction {
  if (stringValue({ node: raw, key: 'CORRECTFITID' }) || stringValue({ node: raw, key: 'CORRECTACTION' })) {
    throw new OfxParseError({ code: 'correction-record', key: 'ofxImport.errors.correctionRecord' });
  }
  const amountText = stringValue({ node: raw, key: 'TRNAMT' });
  if (!amountText) throw new OfxParseError({ code: 'missing-amount', key: 'ofxImport.errors.missingAmount' });
  const amount = parseOfxAmount({ value: amountText });
  const dateText = stringValue({ node: raw, key: 'DTPOSTED' }) ?? stringValue({ node: raw, key: 'DTUSER' });
  if (!dateText) throw new OfxParseError({ code: 'missing-date', key: 'ofxImport.errors.missingDate' });
  if (!stringValue({ node: raw, key: 'DTPOSTED' })) {
    warnings.set('date-user-fallback', (warnings.get('date-user-fallback') ?? 0) + 1);
  }
  const transactionType = (stringValue({ node: raw, key: 'TRNTYPE' }) ?? 'OTHER').toUpperCase();
  const fitId = stringValue({ node: raw, key: 'FITID' });
  if (!fitId) warnings.set('fitid-missing', (warnings.get('fitid-missing') ?? 0) + 1);
  const payee = objectValue({ value: raw.PAYEE });
  const name = boundedText({
    value: stringValue({ node: raw, key: 'NAME' }) ?? (payee ? stringValue({ node: payee, key: 'NAME' }) : undefined),
    field: 'NAME',
    maxLength: PAYEE_NAME_MAX_LENGTH,
  });
  const memo = boundedText({
    value: stringValue({ node: raw, key: 'MEMO' }),
    field: 'MEMO',
    maxLength: TRANSACTION_NOTE_MAX_LENGTH,
  });
  const type = amount.isNegative()
    ? TRANSACTION_TYPES.expense
    : amount.isPositive() || CREDIT_TYPES.has(transactionType)
      ? TRANSACTION_TYPES.income
      : TRANSACTION_TYPES.expense;

  return {
    amount: amount.toBig().toString(),
    checkNumber: stringValue({ node: raw, key: 'CHECKNUM' }),
    date: parseOfxDate({ value: dateText, timezone }),
    note: memo ?? name ?? '',
    payeeName: name ?? null,
    referenceNumber: stringValue({ node: raw, key: 'REFNUM' }),
    rowIndex,
    sourceAccountKey: accountIdentityValue.sourceAccountKey,
    // FITID is unique only within its financial institution and account.
    ...(fitId
      ? { sourceTransactionKey: digest({ parts: [fi.org, fi.fid, accountIdentityValue.sourceAccountKey, fitId] }) }
      : {}),
    transactionType,
    type,
  };
}

export function mapOfxDocument({
  document,
  formatVersion,
  timezone,
}: {
  document: OfxNode;
  formatVersion: OfxFormatVersion;
  timezone?: string;
}): OfxParseResult {
  const ofx = objectValue({ value: document.OFX });
  if (!ofx) throw new OfxParseError({ code: 'missing-root', key: 'ofxImport.errors.missingRoot' });
  const fi = getFinancialInstitution({ ofx });
  const statements = collectStatements({ ofx });
  const warnings = new Map<OfxParseWarning['code'], number>();
  const accounts: OfxParseAccount[] = [];
  const transactions: OfxParseTransaction[] = [];
  const usedNames = new Map<string, number>();
  const seenFitIdsByAccount = new Map<string, Map<string, string>>();
  let rowIndex = 0;

  for (const statement of statements) {
    const identity = accountIdentity({ fi, statement });
    const currency = stringValue({ node: statement.node, key: 'CURDEF' })?.toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      throw new OfxParseError({ code: 'invalid-currency', key: 'ofxImport.errors.invalidCurrency' });
    }
    const transactionList = objectValue({ value: statement.node.BANKTRANLIST });
    const rawTransactions = arrayValue({ value: transactionList?.STMTTRN })
      .map((value) => objectValue({ value }))
      .filter((value): value is Node => value !== null);
    const seenFitIds = seenFitIdsByAccount.get(identity.sourceAccountKey) ?? new Map<string, string>();
    seenFitIdsByAccount.set(identity.sourceAccountKey, seenFitIds);
    const accountTransactions: OfxParseTransaction[] = [];
    let netImportedAmount = Money.zero();
    for (const raw of rawTransactions) {
      if (transactions.length + accountTransactions.length >= OFX_MAX_ROWS) {
        throw new OfxParseError({
          code: 'row-limit',
          key: 'ofxImport.errors.rowLimit',
          params: { max: OFX_MAX_ROWS },
        });
      }
      const fitId = stringValue({ node: raw, key: 'FITID' });
      if (fitId) {
        const signature = transactionSignature({ transaction: raw });
        const previous = seenFitIds.get(fitId);
        if (previous === signature) {
          warnings.set('fitid-duplicate', (warnings.get('fitid-duplicate') ?? 0) + 1);
          continue;
        }
        if (previous) throw new OfxParseError({ code: 'conflicting-fitid', key: 'ofxImport.errors.conflictingFitid' });
        seenFitIds.set(fitId, signature);
      }
      const mapped = mapTransaction({ accountIdentityValue: identity, fi, raw, rowIndex, warnings, timezone });
      netImportedAmount = netImportedAmount.add(parseOfxAmount({ value: stringValue({ node: raw, key: 'TRNAMT' })! }));
      accountTransactions.push(mapped);
      rowIndex += 1;
    }
    transactions.push(...accountTransactions);

    const lastFour = identity.accountId.slice(-4);
    const baseDisplayName = `${identity.accountType} ••••${lastFour}`;
    const collision = (usedNames.get(baseDisplayName) ?? 0) + 1;
    usedNames.set(baseDisplayName, collision);
    const ledger = objectValue({ value: statement.node.LEDGERBAL });
    const ledgerAmount = ledger && stringValue({ node: ledger, key: 'BALAMT' });
    const ledgerDate = ledger && stringValue({ node: ledger, key: 'DTASOF' });
    accounts.push({
      accountType: identity.accountType,
      currency,
      ledgerBalance: ledgerAmount ? parseOfxAmount({ value: ledgerAmount }).toBig().toString() : undefined,
      ledgerBalanceDate: ledgerDate ? parseOfxDate({ value: ledgerDate, timezone }) : undefined,
      maskedDisplayName: collision === 1 ? baseDisplayName : `${baseDisplayName} (${collision})`,
      netImportedAmount: netImportedAmount.toBig().toString(),
      sourceAccountKey: identity.sourceAccountKey,
      statementType: statement.type,
      suggestedLocalName: fi.name ? `${fi.name} ••••${lastFour}` : baseDisplayName,
      transactionCount: accountTransactions.length,
    });
  }

  const dates = transactions.map(({ date }) => date).toSorted();
  return {
    accounts,
    dateRange: dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null,
    financialInstitutionName: fi.name ?? null,
    formatVersion,
    transactions,
    warnings: [...warnings.entries()].map(([code, count]) => ({ code, count })),
  };
}
