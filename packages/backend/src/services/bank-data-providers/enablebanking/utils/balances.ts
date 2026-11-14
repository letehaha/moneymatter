import { Money } from '@common/types/money';

import { BalanceStatus, CashAccountType, type EnableBankingBalance } from '../types';

// Booked types first: available balances already subtract pending holds, which
// must not move the account balance before the bank books them.
const BALANCE_PRIORITY = [BalanceStatus.ITBD, BalanceStatus.CLBD, BalanceStatus.ITAV, BalanceStatus.CLAV];

export function pickAccountBalance({ balances }: { balances: EnableBankingBalance[] }) {
  for (const type of BALANCE_PRIORITY) {
    const balance = balances.find((b) => b.balance_type === type);
    if (balance) return balance;
  }
  return balances[0];
}

// Some ASPSPs (Morrow Bank SE) report savings balances with the sign inverted (bug or not, whoever knows).
// A savings account without a credit line cannot be overdrawn.
export function correctInvertedSavingsBalance({
  balance,
  cashAccountType,
  creditLimitCents,
}: {
  balance: Money;
  cashAccountType: CashAccountType | undefined;
  creditLimitCents: number | undefined;
}): Money {
  return cashAccountType === CashAccountType.SVGS && !creditLimitCents && balance.isNegative()
    ? balance.negate()
    : balance;
}

export function balancesForLog({ balances }: { balances: EnableBankingBalance[] }) {
  // Raw ASPSP records can miss fields the type declares required; `?? null` keeps
  // the gap visible in the logged JSON instead of dropping the key.
  return balances.map((b) => ({
    balance_type: b.balance_type,
    amount: b.balance_amount?.amount ?? null,
    currency: b.balance_amount?.currency ?? null,
    reference_date: b.reference_date ?? null,
  }));
}
