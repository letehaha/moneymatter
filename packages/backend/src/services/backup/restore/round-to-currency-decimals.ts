import { assertMoneyWithinMinorUnitRange } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { toMoneyColumnValue } from '@common/types/money-column';

import { type BackupFileName } from '../registry';
import { type V1ConversionRules, forEachMoneyJsonObject, getLiveRules } from './convert-v1-money';

type Row = Record<string, unknown>;

interface Lookup {
  row: Row;
  object: Row;
  baseCurrency: unknown;
  find: (params: { fileName: BackupFileName; id: unknown }) => Row | undefined;
}
type Pick = (lookup: Lookup) => unknown;

/** The currency an amount is in; for a converted amount also the one it was converted from. */
interface CurrencySource {
  currency: Pick;
  convertedFrom?: Pick;
  /** The column has a `> 0` check. */
  positive?: boolean;
}

const own =
  (attrName: string): Pick =>
  ({ row }) =>
    row[attrName];
const via =
  ({ fileName, key, pick }: { fileName: BackupFileName; key: string; pick: Pick }): Pick =>
  (lookup) => {
    const target = lookup.find({ fileName, id: lookup.row[key] });
    return target ? pick({ ...lookup, row: target }) : undefined;
  };
const base: Pick = ({ baseCurrency }) => baseCurrency;
const snapshot =
  (key: string): Pick =>
  ({ object }) =>
    object[key];

const accountCurrency = via({ fileName: 'accounts', key: 'accountId', pick: own('currencyCode') });
const planCurrency = via({
  fileName: 'budget-lines',
  key: 'lineId',
  pick: via({ fileName: 'budget-plans', key: 'planId', pick: own('currencyCode') }),
});
const transaction = ({ key, attrName }: { key: string; attrName: string }) =>
  via({ fileName: 'transactions', key, pick: own(attrName) });

const OWN: CurrencySource = { currency: own('currencyCode') };
const OWN_REF: CurrencySource = { currency: base, convertedFrom: own('currencyCode') };
const ACCOUNT: CurrencySource = { currency: accountCurrency };
const ACCOUNT_REF: CurrencySource = { currency: base, convertedFrom: accountCurrency };
const PLAN: CurrencySource = { currency: planCurrency };
const TRANSACTION_REF: CurrencySource = { currency: own('refCurrencyCode'), convertedFrom: own('currencyCode') };
const SNAPSHOT_AMOUNT: CurrencySource = { currency: snapshot('currencyCode') };

/** Each money column's currency, keyed `file.attribute`. */
const COLUMN_CURRENCIES: Record<string, CurrencySource> = {
  'accounts.initialBalance': OWN,
  'accounts.refInitialBalance': OWN_REF,
  'accounts.currentBalance': OWN,
  'accounts.refCurrentBalance': OWN_REF,
  'accounts.creditLimit': OWN,
  'accounts.refCreditLimit': OWN_REF,
  'accounts.seamBalance': OWN,
  'balances.amount': ACCOUNT_REF,
  'budget-assignments.baselineAmount': PLAN,
  'budget-assignments.overrideAmount': PLAN,
  'budget-line-goals.amount': { ...PLAN, positive: true },
  'budget-line-goals.stopAtBalance': { ...PLAN, positive: true },
  'budget-line-goals.fundingCap': { ...PLAN, positive: true },
  'budget-plans.expectedIncome': OWN,
  'goal-accounts.fixedAmount': { ...ACCOUNT, positive: true },
  'goals.targetAmount': { ...OWN, positive: true },
  'goals.plannedMonthly': { ...OWN, positive: true },
  'goals.achievedAmount': OWN,
  'import-batch-account-effects.absorbedAmount': ACCOUNT,
  'loan-details.originalPrincipal': ACCOUNT,
  'loan-details.minPayment': ACCOUNT,
  'loan-details.plannedPayment': ACCOUNT,
  'loan-details.refOriginalPrincipal': ACCOUNT_REF,
  'loan-details.refMinPayment': ACCOUNT_REF,
  'loan-details.refPlannedPayment': ACCOUNT_REF,
  'refund-transactions.amount': {
    currency: transaction({ key: 'refundTxId', attrName: 'currencyCode' }),
    positive: true,
  },
  'subscription-candidates.averageAmount': OWN,
  'subscriptions.expectedAmount': { currency: own('expectedCurrencyCode') },
  'tracker-lines.limitAmount': { currency: base },
  'trackers.limitAmount': { currency: base },
  'transaction-splits.amount': { currency: transaction({ key: 'transactionId', attrName: 'currencyCode' }) },
  'transaction-splits.refAmount': {
    currency: transaction({ key: 'transactionId', attrName: 'refCurrencyCode' }),
    convertedFrom: transaction({ key: 'transactionId', attrName: 'currencyCode' }),
  },
  'transaction-templates.amount': ACCOUNT,
  'transactions.amount': OWN,
  'transactions.refAmount': TRANSACTION_REF,
  'transactions.commissionRate': OWN,
  'transactions.refCommissionRate': TRANSACTION_REF,
  'transactions.cashbackAmount': OWN,
  'transactions.originalAmount': { currency: own('originalCurrencyCode') },
  'transactions.paymentAmount': { currency: transaction({ key: 'paymentParentId', attrName: 'currencyCode' }) },
  'vehicles.purchasePrice': ACCOUNT,
  'vehicles.valueAnchor': ACCOUNT,
};

const JSON_KEY_CURRENCIES: Record<string, Record<string, CurrencySource>> = {
  'tag-reminders.settings': { amountThreshold: { currency: base } },
  'loan-details.events': { fromCents: ACCOUNT, toCents: ACCOUNT },
  'venture-event-links.metaData': {
    amount: SNAPSHOT_AMOUNT,
    refAmount: { currency: snapshot('refCurrencyCode'), convertedFrom: snapshot('currencyCode') },
  },
  // The portfolio snapshot stores no refCurrencyCode; its refAmount is in the base currency.
  'portfolio-transfers.metaData': {
    amount: SNAPSHOT_AMOUNT,
    refAmount: { currency: base, convertedFrom: snapshot('currencyCode') },
  },
  'accounts.externalData': { systemBalance: OWN, externalBalance: OWN, difference: OWN, absorbedResidual: OWN },
};

/** File-attribute keys of the money columns and JSON keys without a currency source. */
export function findMoneyWithoutCurrencySource({ rules = getLiveRules() }: { rules?: V1ConversionRules } = {}) {
  return [
    ...rules.columns
      .map(({ fileName, attrName }) => `${fileName}.${attrName}`)
      .filter((key) => !COLUMN_CURRENCIES[key]),
    ...rules.jsonFields.flatMap(({ fileName, attrName, keys }) =>
      keys
        .filter((key) => !JSON_KEY_CURRENCIES[`${fileName}.${attrName}`]?.[key])
        .map((key) => `${fileName}.${attrName}.${key}`),
    ),
  ];
}

/**
 * Round every archive amount to its currency's decimals: native half-up, converted half-even. An
 * amount with an unresolved currency, or a `> 0` amount that would round to 0, stays as it is.
 * Throws a `ValidationError` for an amount too large for its currency's minor-unit range.
 */
export function roundMoneyToCurrencyDecimals({
  data,
  digitsByCode,
  rules = getLiveRules(),
}: {
  data: Map<BackupFileName, Row[]>;
  digitsByCode: ReadonlyMap<string, number>;
  rules?: V1ConversionRules;
}): void {
  const indexes = new Map<BackupFileName, Map<string, Row>>();
  const find: Lookup['find'] = ({ fileName, id }) => {
    if (id === undefined || id === null) return undefined;
    let index = indexes.get(fileName);
    if (!index) {
      index = new Map((data.get(fileName) ?? []).map((row) => [String(row.id), row]));
      indexes.set(fileName, index);
    }
    return index.get(String(id));
  };
  const baseCurrency = (data.get('users-currencies') ?? []).find((row) => row.isDefaultCurrency)?.currencyCode;

  const rounded = ({ value, source, lookup }: { value: unknown; source: CurrencySource; lookup: Lookup }) => {
    if (value === undefined || value === null) return undefined;
    const currency = source.currency(lookup);
    if (typeof currency !== 'string') return undefined;
    const digits = digitsByCode.get(currency);
    if (digits === undefined) return undefined;
    const money = Money.fromDecimal(value as string | number);
    const result =
      source.convertedFrom && source.convertedFrom(lookup) !== currency
        ? money.roundHalfEven(digits)
        : money.round(digits);
    assertMoneyWithinMinorUnitRange({ money: result, decimals: digits, code: currency });
    if (result.equals(money) || (source.positive && result.isZero())) return undefined;
    return result;
  };

  for (const { fileName, attrName } of rules.columns) {
    const source = COLUMN_CURRENCIES[`${fileName}.${attrName}`];
    if (!source) continue;
    for (const row of data.get(fileName) ?? []) {
      const money = rounded({ value: row[attrName], source, lookup: { row, object: row, baseCurrency, find } });
      if (money) row[attrName] = toMoneyColumnValue({ money });
    }
  }

  for (const rule of rules.jsonFields) {
    const sources = JSON_KEY_CURRENCIES[`${rule.fileName}.${rule.attrName}`];
    if (!sources) continue;
    forEachMoneyJsonObject({
      data,
      rule,
      visit: ({ row, object }) => {
        for (const key of rule.keys) {
          const source = sources[key];
          if (!source) continue;
          const money = rounded({ value: object[key], source, lookup: { row, object, baseCurrency, find } });
          if (money) object[key] = money.toNumber();
        }
      },
    });
  }
}
