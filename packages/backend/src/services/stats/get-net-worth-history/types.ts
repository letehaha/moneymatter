import type { Cents, NetWorthAssetKind, NetWorthHistoryDegraded, NetWorthLiabilityKind } from '@bt/shared/types';

/** One end-of-bucket snapshot, all money in base-currency cents. */
export interface NetWorthHistoryPointCents {
  /** yyyy-MM-dd — the bucket-end date the snapshot is taken at. */
  date: string;
  /**
   * Balance per asset kind. `cash` folds every non-liability account (signed, so
   * an overdrawn one subtracts) plus any credit-card/overdraft account holding a
   * positive balance; `investments` is portfolios (holdings + cash); `vehicles`
   * and `ventures` are their valued balances.
   */
  assets: Record<NetWorthAssetKind, Cents>;
  /** Sum of the `assets` values. */
  assetsTotal: Cents;
  /**
   * Balance per liability account category. Credit-card and overdraft carry only
   * their owing accounts (values ≤ 0) — a positive balance on those accounts
   * counts as `assets.cash` instead; loan carries its whole signed value.
   */
  liabilities: Record<NetWorthLiabilityKind, Cents>;
  /** Sum of the `liabilities` values. */
  liabilitiesTotal: Cents;
  /** assetsTotal + liabilitiesTotal. */
  netWorth: Cents;
}

export interface NetWorthHistoryResultCents {
  points: NetWorthHistoryPointCents[];
  /** Absent when the range valued cleanly; never an empty object (see `buildDegraded`). */
  degraded?: NetWorthHistoryDegraded;
}
