/** The balance fields the credit-limit display adjustment reads. */
interface CreditLimitBalanceInput {
  currentBalance: number;
  refCurrentBalance: number;
  creditLimit: number;
  refCreditLimit: number;
  /** When true, an account carrying a credit limit shows its balance net of that limit. */
  includeCreditLimit: boolean;
}

interface AccountDisplayBalances {
  hasCreditLimitAdjustment: boolean;
  /** Balance in the account's own currency, net of the credit limit when adjusting. */
  displayBalance: number;
  /** Balance in the user's base currency, net of the credit limit when adjusting. */
  displayRefBalance: number;
}

/**
 * Credit drawn on an account, for either the native or the ref balance pair.
 * When the balance itself embeds the credit limit, used is the limit minus the
 * balance at any sign. Otherwise a negative balance is debt owed, and a positive
 * or zero one is either available credit (used = limit minus balance) or, for
 * debt-style tracking, an overpaid or untouched card with nothing drawn.
 */
export const computeCreditUsed = ({
  balance,
  creditLimit,
  balanceIncludesCreditLimit,
  balanceIsAvailableCredit,
}: {
  balance: number;
  creditLimit: number;
  balanceIncludesCreditLimit: boolean;
  balanceIsAvailableCredit: boolean;
}): number => {
  if (balanceIncludesCreditLimit) return Math.max(creditLimit - balance, 0);
  if (balance < 0) return -balance;
  return balanceIsAvailableCredit ? Math.max(creditLimit - balance, 0) : 0;
};

/**
 * Credit-limit-adjusted balances for an account, in both its own and the base currency.
 * The single source for this rule so the per-row display (`useAccountDisplayBalance`) and
 * the sidebar group roll-ups (`sumAccountsBaseBalance`) can't drift out of sync.
 */
export const computeAccountDisplayBalances = ({
  currentBalance,
  refCurrentBalance,
  creditLimit,
  refCreditLimit,
  includeCreditLimit,
}: CreditLimitBalanceInput): AccountDisplayBalances => {
  const hasCreditLimitAdjustment = includeCreditLimit && creditLimit > 0;
  if (!hasCreditLimitAdjustment) {
    return { hasCreditLimitAdjustment, displayBalance: currentBalance, displayRefBalance: refCurrentBalance };
  }

  return {
    hasCreditLimitAdjustment,
    displayBalance: currentBalance - creditLimit,
    displayRefBalance: refCurrentBalance - refCreditLimit,
  };
};
