import {
  ACCOUNT_CATEGORIES,
  type Cents,
  NET_WORTH_ASSET_KINDS,
  NET_WORTH_LIABILITY_KINDS,
  type NetWorthAssetKind,
  type NetWorthLiabilityKind,
  asCents,
} from '@bt/shared/types';

import type { NetWorthHistoryPointCents } from './types';

/** One account partition's balances at a snapshot, split by sign upstream. */
export interface AccountSignSplit {
  /** Sum of the accounts currently owing (negative balances), so ≤ 0. */
  owedCents: Cents;
  /** Sum of the accounts holding the user's own funds (positive balances), so ≥ 0. */
  surplusCents: Cents;
}

/**
 * Group one snapshot's already-split account balances and valued asset classes
 * into the report's asset and liability kinds. Pure: the per-account sign split,
 * loan resolution and portfolio/vehicle/venture valuation all happen upstream, so
 * this owns only the folding rules and the totals — which is where the classifying
 * bugs hide, and why it lives apart from the DB-backed service:
 *
 * - an overdrawn deposit account is debt with no liability category of its own, so
 *   its owed balance joins the overdraft kind; `cash` folds only positive balances,
 *   so it never goes negative;
 * - a credit-card or overdraft account in the black folds its surplus into `cash`;
 * - a loan passes through at its whole signed value, so an overpaid one reads positive.
 */
export const assembleNetWorthPoint = ({
  date,
  assetAccounts,
  creditCard,
  overdraft,
  loanCents,
  portfolioCents,
  vehicleCents,
  ventureCents,
}: {
  date: string;
  assetAccounts: AccountSignSplit;
  creditCard: AccountSignSplit;
  overdraft: AccountSignSplit;
  loanCents: Cents;
  portfolioCents: Cents;
  vehicleCents: Cents;
  ventureCents: Cents;
}): NetWorthHistoryPointCents => {
  const overdraftOwedCents = asCents(overdraft.owedCents + assetAccounts.owedCents);

  const assets: Record<NetWorthAssetKind, Cents> = {
    cash: asCents(assetAccounts.surplusCents + creditCard.surplusCents + overdraft.surplusCents),
    investments: portfolioCents,
    vehicles: vehicleCents,
    ventures: ventureCents,
  };
  const assetsTotal = asCents(NET_WORTH_ASSET_KINDS.reduce((sum, kind) => sum + assets[kind], 0));

  // Each kind's owed cents come from a different upstream computation (loan is a
  // plain resolver, credit-card/overdraft are sign-split), so this literal is the
  // one place that pairs a kind with its value; the type forces every kind present.
  const liabilities: Record<NetWorthLiabilityKind, Cents> = {
    [ACCOUNT_CATEGORIES.creditCard]: creditCard.owedCents,
    [ACCOUNT_CATEGORIES.loan]: loanCents,
    [ACCOUNT_CATEGORIES.overdraft]: overdraftOwedCents,
  };
  const liabilitiesTotal = asCents(NET_WORTH_LIABILITY_KINDS.reduce((sum, kind) => sum + liabilities[kind], 0));

  return {
    date,
    assets,
    assetsTotal,
    liabilities,
    liabilitiesTotal,
    netWorth: asCents(assetsTotal + liabilitiesTotal),
  };
};
