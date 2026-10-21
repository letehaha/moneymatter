import type { MinorUnits, NetWorthAssetKind, NetWorthHistoryDegraded, NetWorthLiabilityKind } from '@bt/shared/types';

/** One end-of-bucket snapshot, all money in base-currency minor units. */
export interface NetWorthHistoryPointMinor {
  /** yyyy-MM-dd — the bucket-end date the snapshot is taken at. */
  date: string;
  /**
   * Balance per asset kind. `cash` folds every non-liability account (signed, so
   * an overdrawn one subtracts) plus any credit-card/overdraft account holding a
   * positive balance; `investments` is portfolios (holdings + cash); `vehicles`
   * and `ventures` are their valued balances.
   */
  assets: Record<NetWorthAssetKind, MinorUnits>;
  /** Sum of the `assets` values. */
  assetsTotal: MinorUnits;
  /**
   * Balance per liability account category. Credit-card and overdraft carry only
   * their owing accounts (values ≤ 0) — a positive balance on those accounts
   * counts as `assets.cash` instead; loan carries its whole signed value.
   */
  liabilities: Record<NetWorthLiabilityKind, MinorUnits>;
  /** Sum of the `liabilities` values. */
  liabilitiesTotal: MinorUnits;
  /** assetsTotal + liabilitiesTotal. */
  netWorth: MinorUnits;
}

export interface NetWorthHistoryResultMinor {
  points: NetWorthHistoryPointMinor[];
  /** Absent when the range valued cleanly; never an empty object (see `buildDegraded`). */
  degraded?: NetWorthHistoryDegraded;
}
