import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { getAccountById } from '@models/accounts.model';
import Properties from '@models/properties.model';
import type Transactions from '@models/transactions.model';
import { getUserDefaultCategory } from '@models/users.model';
import Vehicles from '@models/vehicles.model';
import { withTransaction } from '@services/common/with-transaction';
import { computePropertyValue } from '@services/properties/compute-property-value';
import { refreshPropertyValueIfStale } from '@services/properties/refresh-property-value.service';
import { createTransaction } from '@services/transactions/create-transaction';
import { refreshVehicleValueIfStale } from '@services/vehicles/refresh-vehicle-value.service';
import { format, parseISO } from 'date-fns';

/**
 * Categories whose `currentBalance` is projected by a curve anchored on a 1:1
 * sidecar row. Adjusting one means overriding the projection, so the sidecar's
 * anchor has to move with it — see `allowDedicatedFlow`.
 */
const MANAGED_VALUE_CATEGORIES = {
  [ACCOUNT_CATEGORIES.vehicle]: 'balanceAdjustment.vehicleUseOverride',
  [ACCOUNT_CATEGORIES.property]: 'balanceAdjustment.propertyUseOverride',
} as const;

const isManagedValueCategory = (category: ACCOUNT_CATEGORIES): category is keyof typeof MANAGED_VALUE_CATEGORIES =>
  category in MANAGED_VALUE_CATEGORIES;

interface AdjustAccountBalanceParams {
  userId: number;
  accountId: string;
  targetBalance: Money;
  note?: string;
  /** Effective date of the adjustment. Defaults to now when omitted — pass a past date to backdate. */
  time?: Date;
}

interface AdjustAccountBalanceResult {
  transaction: Transactions | null;
  previousBalance: Money;
  newBalance: Money;
}

/** Creates the row that shifts an account's balance by a signed, non-zero `amountDelta`. */
export const createBalanceAdjustmentTransaction = async ({
  userId,
  accountId,
  amountDelta,
  time,
  note,
}: {
  userId: number;
  accountId: string;
  amountDelta: Money;
  time: Date;
  note?: string;
}): Promise<Transactions> => {
  const defaultCategoryId = await getUserDefaultCategory({ id: userId });

  const [transaction] = await createTransaction({
    userId,
    accountId,
    amount: amountDelta.abs(),
    transactionType: amountDelta.isPositive() ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
    transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    accountType: ACCOUNT_TYPES.system,
    paymentType: PAYMENT_TYPES.bankTransfer,
    note: note ?? t({ key: 'balanceAdjustment.defaultNote' }),
    categoryId: defaultCategoryId,
    time,
    // `transfer_out_wallet` alone can't identify adjustments — imports and
    // cross-user transfer conversions produce it too, so mark explicitly.
    externalData: { balanceAdjustment: true },
  });

  return transaction;
};

export const adjustAccountBalance = withTransaction(
  async ({
    userId,
    accountId,
    targetBalance,
    note,
    time,
  }: AdjustAccountBalanceParams): Promise<AdjustAccountBalanceResult> => {
    const account = await getAccountById({ id: accountId, userId });

    if (!account) {
      throw new NotFoundError({
        message: t({ key: 'balanceAdjustment.accountNotFound', variables: { accountId } }),
      });
    }

    if (account.type !== ACCOUNT_TYPES.system) {
      throw new ValidationError({ message: t({ key: 'transactions.manualOnConnectedAccount' }) });
    }

    // Negative value for the car is impossible
    if (isManagedValueCategory(account.accountCategory) && targetBalance.isNegative()) {
      throw new ValidationError({
        message: t({ key: MANAGED_VALUE_CATEGORIES[account.accountCategory] }),
      });
    }

    const previousBalance = account.currentBalance;
    let adjustmentBaseline = previousBalance;
    const effectiveTime = time ?? new Date();

    if (time && account.accountCategory === ACCOUNT_CATEGORIES.property) {
      const property = await Properties.findOne({ where: { accountId } });
      if (property) {
        const hasAnchor = property.valueAnchor !== null && property.valueAnchorDate !== null;
        adjustmentBaseline = computePropertyValue({
          anchorValue: hasAnchor ? property.valueAnchor! : property.purchasePrice,
          anchorDate: parseISO(hasAnchor ? property.valueAnchorDate! : property.purchaseDate),
          asOf: effectiveTime,
          annualRatePct: Number(property.annualAppreciationRatePct),
        });
      }
    }

    const diff = targetBalance.subtract(adjustmentBaseline);

    if (diff.isZero()) {
      return {
        transaction: null,
        previousBalance,
        newBalance: previousBalance,
      };
    }

    const transaction = await createBalanceAdjustmentTransaction({
      userId,
      accountId,
      amountDelta: diff,
      time: effectiveTime,
      note,
    });

    // Vehicles and properties aren't real accounts in the usual sense — they're
    // assets whose value drifts along a curve. When a user manually adjusts the
    // balance, that IS an override of the model's projection, so we re-anchor
    // the curve to (targetBalance, effectiveTime). Without this, the next
    // stale-cache refresh would recompute from the original purchase and
    // silently overwrite the user's adjustment.
    //
    // If the override is backdated, today's projected value differs from the
    // target the user typed (which was the value at `effectiveTime`), so we
    // force-refresh and report the refreshed figure — otherwise the page header
    // reads stale.
    let newBalance = targetBalance;
    const anchorDate = format(effectiveTime, 'yyyy-MM-dd');

    if (account.accountCategory === ACCOUNT_CATEGORIES.vehicle) {
      const vehicle = await Vehicles.findOne({ where: { accountId } });
      if (vehicle) {
        await vehicle.update({
          valueAnchor: targetBalance,
          valueAnchorDate: anchorDate,
          // Null out the cache so the refresh below recomputes from the new
          // (anchor, anchorDate) instead of returning a stale cached balance.
          valueLastComputedAt: null,
        });

        const refreshed = await refreshVehicleValueIfStale({ vehicleId: vehicle.id, force: true });
        newBalance = refreshed.value;
      }
    } else if (account.accountCategory === ACCOUNT_CATEGORIES.property) {
      const property = await Properties.findOne({ where: { accountId } });
      if (property) {
        await property.update({
          valueAnchor: targetBalance,
          valueAnchorDate: anchorDate,
          valueLastComputedAt: null,
        });

        const refreshed = await refreshPropertyValueIfStale({ propertyId: property.id, force: true });
        newBalance = refreshed.value;
      }
    }

    return {
      transaction,
      previousBalance,
      newBalance,
    };
  },
);
