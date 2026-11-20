import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import type { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Accounts from '@models/accounts.model';
import { findTransactions } from '@models/transactions-query';
import type Vehicles from '@models/vehicles.model';
import { format, parseISO } from 'date-fns';
import { Op } from 'sequelize';

import { computeVehicleValue } from './compute-vehicle-value';

interface ReconstructAnchorParams {
  vehicle: Vehicles;
  /** Optional cutoff — only include override txs ≤ this date. Defaults to now. */
  asOf?: Date;
}

interface ReconstructedAnchor {
  /** Anchor value at `date`, expressed in the vehicle's account currency. */
  value: Money;
  /** yyyy-MM-dd. Date the anchor was set (purchase or latest override ≤ cutoff). */
  date: string;
  /** True if any override was applied; false if anchor is the original purchase. */
  hasOverrides: boolean;
}

const getVehicleAccountDecimals = async ({ vehicle }: { vehicle: Vehicles }): Promise<number> => {
  const account = await findOrThrowNotFound({
    query: Accounts.findByPk(vehicle.accountId, { attributes: ['currencyCode'] }),
    message: t({ key: 'accounts.accountNotFound' }),
  });
  return getCurrencyDecimals({ userId: vehicle.userId, code: account.currencyCode });
};

/**
 * Walk the vehicle's override transactions forward from purchase, applying each
 * override's signed amount on top of the curve-depreciated value at that date.
 * Returns the final (anchor value, anchor date) — i.e. the post-tx value of the
 * latest override, with all prior anchors collapsed into it.
 *
 * Used wherever the live `valueAnchor` field needs to be re-derived from tx
 * history rather than read directly: the AfterDestroy hook on Transactions
 * (when an override is deleted) and the stats history calculator.
 */
export async function reconstructVehicleAnchor({
  vehicle,
  asOf,
}: ReconstructAnchorParams): Promise<ReconstructedAnchor> {
  const cutoff = asOf ?? new Date();

  // Overrides are written by the balance-adjustment flow, which stamps them as adjustments —
  // excluding those (the boundary's default) would erase every anchor after the purchase.
  const overrideTxs = await findTransactions({
    planned: 'exclude',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    transfers: { natures: [TRANSACTION_TRANSFER_NATURE.transfer_out_wallet] },
    completeness: 'all',
    where: {
      accountId: vehicle.accountId,
      time: { [Op.lte]: cutoff },
    },
    order: [
      ['time', 'ASC'],
      ['createdAt', 'ASC'],
    ],
  });

  if (!overrideTxs.length) {
    return { value: vehicle.purchasePrice, date: vehicle.purchaseDate, hasOverrides: false };
  }

  let anchorValue = vehicle.purchasePrice;
  let anchorDateStr = vehicle.purchaseDate;
  const customRate = vehicle.customAnnualRatePct ? Number(vehicle.customAnnualRatePct) : null;
  const salvage = Number(vehicle.salvageFloorPct);
  // Each override lands on a curve value held at the account currency's decimals.
  const decimals = await getVehicleAccountDecimals({ vehicle });

  for (const tx of overrideTxs) {
    const txDateStr = format(tx.time, 'yyyy-MM-dd');

    const preTxValue = computeVehicleValue({
      anchorValue,
      anchorDate: parseISO(anchorDateStr),
      asOf: parseISO(txDateStr),
      vehicleClass: vehicle.vehicleClass,
      preset: vehicle.depreciationPreset,
      customAnnualRatePct: customRate,
      salvageFloorPct: salvage,
    });

    anchorValue = preTxValue
      .round(decimals)
      .add(tx.transactionType === TRANSACTION_TYPES.income ? tx.amount : tx.amount.negate());
    anchorDateStr = txDateStr;
  }

  return {
    value: anchorValue,
    date: anchorDateStr,
    hasOverrides: true,
  };
}
