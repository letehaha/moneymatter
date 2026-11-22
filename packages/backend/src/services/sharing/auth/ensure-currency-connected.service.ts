import { t } from '@i18n/index';
import { UnexpectedError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Currencies from '@models/currencies.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrenciesModel, * as UsersCurrencies from '@models/users-currencies.model';
import { LOGO_FIELD_KEYS } from '@services/brand-logos/apply-manual-logo-patch';
import { withTransaction } from '@services/common/with-transaction';
import { assertCurrencyCodesVisible } from '@services/currencies/assert-currency-codes-visible';
import { lockUserCurrencies } from '@services/currencies/lock-user-currencies';
import { findPeg } from '@services/currencies/rate-sources/peg';
import { copyLogoImageIfPresent } from '@services/logo-images/logo-images.service';
import pick from 'lodash/pick';

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
      where: { userId: ownerRow.userId, baseCode: currencyCode },
      attributes: ['baseCode', 'quoteCode', 'rate', 'effectiveDate', 'source'],
      raw: true,
    });
    await UserExchangeRates.bulkCreate(ownerRates.map((rate) => ({ ...rate, userId })));

    // A peg values the currency without stored rows, so its config is copied. A synced source is not:
    // it would fetch on the user's behalf, and its encrypted headers belong to the owner.
    const peg = await findPeg({ userId: ownerRow.userId, code: currencyCode });
    const quotes = new Set(ownerRates.map((rate) => rate.quoteCode));
    if (peg) quotes.add(peg.quoteCode);
    for (const quote of quotes) await UsersCurrencies.addCurrency({ userId, currencyCode: quote });

    return UsersCurrenciesModel.create({
      userId,
      currencyCode,
      liveRateUpdate: false,
      isDefaultCurrency: false,
      nameOverride: ownerRow.nameOverride,
      symbolOverride: ownerRow.symbolOverride,
      decimalsOverride: ownerRow.decimalsOverride,
      rateSource: peg ? 'peg' : 'manual',
      rateSourceConfig: peg ? { pegCurrency: peg.quoteCode, factor: peg.factor } : null,
      ...pick(ownerRow, LOGO_FIELD_KEYS),
      // A logo blob has one owner row, which deletes it on edit or delete. A failed copy must not
      // fail the collaborator's write, so the copy goes without the image.
      logoImageId: await copyLogoImageIfPresent({ id: ownerRow.logoImageId }).catch((error: unknown) => {
        logger.error(
          { message: 'Failed to copy a custom currency logo image', error: error as Error },
          { code: 'LOGO_IMAGE_COPY_FAILED', logoImageId: ownerRow.logoImageId },
        );
        return null;
      }),
    });
  },
);
