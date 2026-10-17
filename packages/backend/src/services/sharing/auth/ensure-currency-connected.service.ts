import Currencies from '@models/currencies.model';
import UsersCurrenciesModel, * as UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';

/**
 * Idempotently ensure that `currencyCode` is connected to the user and return
 * the connected UsersCurrencies row (existing or freshly created). Service-level
 * entry point for the "currency not connected → connect it mid-flow" pattern.
 *
 * On the shared-account write path this prevents a recipient who writes a
 * transaction on an account whose currency they haven't connected (different
 * from their base currency) from hitting `currencyNotConnected` in the
 * downstream ref-amount lookup. Runs inside the surrounding `withTransaction`
 * context so the insert rolls back with the rest of the write on failure.
 *
 * A custom currency connected this way takes the name, symbol, decimals and logo of
 * `definitionOwnerUserId` (the account owner), so the recipient sees the code the way the
 * account's owner defined it instead of whatever the creator of the global row chose.
 *
 * NOTE: UsersCurrencies has no UNIQUE(userId, currencyCode) index, so
 * insert-or-adopt via savepoint (see run-in-savepoint.ts) would catch nothing
 * here — find-or-create (UsersCurrencies.addCurrency) is the contract.
 */
export const ensureUserCurrencyConnected = withTransaction(
  async ({
    userId,
    currencyCode,
    definitionOwnerUserId,
  }: {
    userId: number;
    currencyCode: string;
    definitionOwnerUserId?: number;
  }) => {
    const alreadyConnected = await UsersCurrenciesModel.findOne({
      where: { userId, currencyCode },
      attributes: ['id'],
    });
    const connected = await UsersCurrencies.addCurrency({ userId, currencyCode });
    if (alreadyConnected) return connected;

    // A custom currency has no market rates: the connection uses the user's own rate, and takes
    // the account owner's definition when there is one.
    const currency = await Currencies.findByPk(currencyCode);
    if (!currency?.isCustom) return connected;

    const ownerRow =
      definitionOwnerUserId !== undefined && definitionOwnerUserId !== userId
        ? await UsersCurrenciesModel.findOne({ where: { userId: definitionOwnerUserId, currencyCode } })
        : null;
    const changes = {
      liveRateUpdate: false,
      ...(ownerRow && {
        nameOverride: ownerRow.nameOverride,
        symbolOverride: ownerRow.symbolOverride,
        decimalsOverride: ownerRow.decimalsOverride,
        logoUrl: ownerRow.logoUrl,
      }),
    };

    await UsersCurrenciesModel.update(changes, { where: { userId, currencyCode } });
    Object.assign(connected, changes);

    return connected;
  },
);
