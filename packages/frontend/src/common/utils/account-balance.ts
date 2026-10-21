/** The balance fields the credit-limit display adjustment reads. */
interface CreditLimitBalanceInput {
  currentBalance: number;
  /** `null` while a custom currency has no rate: the account adds nothing to a base-currency total. */
  refCurrentBalance: number | null;
  creditLimit: number;
  refCreditLimit: number | null;
  /** When true, an account carrying a credit limit shows its balance net of that limit. */
  includeCreditLimit: boolean;
}

interface AccountDisplayBalances {
  hasCreditLimitAdjustment: boolean;
  /** Balance in the account's own currency, net of the credit limit when adjusting. */
  displayBalance: number;
  /** Balance in the user's base currency, net of the credit limit when adjusting; 0 while there is no rate. */
  displayRefBalance: number;
}

/**
 * Credit drawn on an account, for either the native or the ref balance pair.
 * When the balance itself embeds the credit limit, used is the limit minus the
 * balance at any sign. Otherwise a positive balance is available credit and a
 * negative one is debt owed; zero is ambiguous, so the caller decides whether it
 * reads as a fully drawn card.
 */
export const computeCreditUsed = ({
  balance,
  creditLimit,
  balanceIncludesCreditLimit,
  zeroBalanceMeansFullyDrawn,
}: {
  balance: number;
  creditLimit: number;
  balanceIncludesCreditLimit: boolean;
  zeroBalanceMeansFullyDrawn: boolean;
}): number => {
  if (balanceIncludesCreditLimit) return Math.max(creditLimit - balance, 0);
  if (balance > 0) return Math.max(creditLimit - balance, 0);
  if (balance < 0) return -balance;
  return zeroBalanceMeansFullyDrawn ? creditLimit : 0;
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
  // A missing base-currency value counts as nothing, so the account drops out of base-currency sums.
  const refBalance = refCurrentBalance ?? 0;
  if (!hasCreditLimitAdjustment) {
    return { hasCreditLimitAdjustment, displayBalance: currentBalance, displayRefBalance: refBalance };
  }

  return {
    hasCreditLimitAdjustment,
    displayBalance: currentBalance - creditLimit,
    displayRefBalance: refCurrentBalance === null ? 0 : refBalance - (refCreditLimit ?? 0),
  };
};
