import { accountBaseValue } from './accounts-sort';

/** The only fields the overview roll-up reads off an account. */
interface OverviewAccount {
  currentBalance: number;
  refCurrentBalance: number;
  creditLimit: number;
  refCreditLimit: number;
  currencyCode: string;
}

export interface AccountsOverview {
  /** Net worth of money accounts in the base currency: assets + liabilities. */
  total: number;
  /** Sum of positive money-account base-currency balances. */
  assets: number;
  /** Sum of negative money-account base-currency balances (<= 0). */
  liabilities: number;
  /** Sum of every vehicle account's base-currency balance. */
  vehicles: number;
  /** Sum of every property account's base-currency balance. */
  properties: number;
  /** True when any money, vehicle or property account sits in a non-base currency, so the totals roll up converted figures. */
  isApprox: boolean;
}

/** True when the account is converted from another currency into the base currency. */
const isConverted = ({
  account,
  baseCurrencyCode,
}: {
  account: OverviewAccount;
  baseCurrencyCode: string | undefined;
}): boolean => Boolean(baseCurrencyCode) && account.currencyCode !== baseCurrencyCode;

/**
 * Summary numbers for the Accounts page overview card: money-account net worth split
 * into assets and liabilities, plus separate vehicle and property totals. Every figure
 * is in the user's base currency, and `isApprox` flags when any account was converted
 * from another.
 */
export const computeAccountsOverview = ({
  moneyAccounts,
  vehicleAccounts,
  propertyAccounts,
  baseCurrencyCode,
  includeCreditLimit,
}: {
  moneyAccounts: OverviewAccount[];
  vehicleAccounts: OverviewAccount[];
  propertyAccounts: OverviewAccount[];
  baseCurrencyCode: string | undefined;
  includeCreditLimit: boolean;
}): AccountsOverview => {
  let assets = 0;
  let liabilities = 0;
  let vehicles = 0;
  let properties = 0;
  let isApprox = false;

  for (const account of moneyAccounts) {
    const balance = accountBaseValue({ account, includeCreditLimit });
    if (balance > 0) assets += balance;
    else if (balance < 0) liabilities += balance;
    if (isConverted({ account, baseCurrencyCode })) isApprox = true;
  }

  for (const account of vehicleAccounts) {
    vehicles += accountBaseValue({ account, includeCreditLimit });
    if (isConverted({ account, baseCurrencyCode })) isApprox = true;
  }

  for (const account of propertyAccounts) {
    properties += accountBaseValue({ account, includeCreditLimit });
    if (isConverted({ account, baseCurrencyCode })) isApprox = true;
  }

  return { total: assets + liabilities, assets, liabilities, vehicles, properties, isApprox };
};
