import { t } from '@i18n/index';
import { UnexpectedError, ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrenciesModel, * as UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { assertCurrencyCodesVisible } from '@services/currencies/assert-currency-codes-visible';
import { lockUserCurrencies } from '@services/currencies/lock-user-currencies';
import { Op } from 'sequelize';

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
 * A custom currency is connected only from `definitionOwnerUserId` (the account owner), whose
 * definition and rates the user gets a copy of; a custom code neither user holds is rejected like an
 * unknown one.
 *
 * UsersCurrencies has no UNIQUE(userId, currencyCode) index, so the miss is re-checked under the
 * per-user lock before inserting.
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
    const isOtherOwner = definitionOwnerUserId !== undefined && definitionOwnerUserId !== userId;
    const findOwnerRow = () =>
      isOtherOwner ? UsersCurrenciesModel.findOne({ where: { userId: definitionOwnerUserId, currencyCode } }) : null;

    const findExisting = async () => {
      const row = await UsersCurrenciesModel.findOne({ where: { userId, currencyCode } });
      // Only a custom holding carries decimals of its own.
      if (row?.decimalsOverride == null || !isOtherOwner) return row;

      // ponytail: a connected copy keeps no provenance, so a self-made definition is told apart by
      // its decimals only; a same-decimals one, or a copy whose rate went stale, still prices with
      // the caller's rates. Upgrade path: price the custom leg with the owner's rates.
      const ownerRow = await findOwnerRow();
      if (ownerRow && ownerRow.decimalsOverride !== row.decimalsOverride) {
        throw new ValidationError({
          message: t({ key: 'currencies.customCurrencyDefinitionConflict', variables: { code: currencyCode } }),
        });
      }

      return row;
    };
    const existing = await findExisting();
    if (existing) return existing;

    await lockUserCurrencies({ userId });
    const lockedExisting = await findExisting();
    if (lockedExisting) return lockedExisting;

    const currency = await Currencies.findByPk(currencyCode);
    if (!currency?.isCustom) return UsersCurrencies.addCurrency({ userId, currencyCode });

    const ownerRow = await findOwnerRow();
    if (!ownerRow) {
      await assertCurrencyCodesVisible({ userId, codes: [currencyCode] });
      throw new UnexpectedError({ message: `Custom currency ${currencyCode} is visible without a holding` });
    }

    const ownerRates = await UserExchangeRates.findAll({
      where: { userId: ownerRow.userId, [Op.or]: [{ baseCode: currencyCode }, { quoteCode: currencyCode }] },
      attributes: ['baseCode', 'quoteCode', 'rate'],
      raw: true,
    });
    await UserExchangeRates.bulkCreate(ownerRates.map((rate) => ({ ...rate, userId })));

    const quote = ownerRates.find((rate) => rate.baseCode === currencyCode)?.quoteCode;
    if (quote) await UsersCurrencies.addCurrency({ userId, currencyCode: quote });

    return UsersCurrenciesModel.create({
      userId,
      currencyCode,
      liveRateUpdate: false,
      isDefaultCurrency: false,
      nameOverride: ownerRow.nameOverride,
      symbolOverride: ownerRow.symbolOverride,
      decimalsOverride: ownerRow.decimalsOverride,
      logoUrl: ownerRow.logoUrl,
    });
  },
);
