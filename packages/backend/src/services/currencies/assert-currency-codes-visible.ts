import { FEATURES } from '@bt/shared/types';
import { isCurrencyCodeFormat, normalizeCurrencyCode } from '@common/lib/currency-code-format';
import { t } from '@i18n/index';
import { PlanRequiredError, ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import UsersCurrencies from '@models/users-currencies.model';
import { FEATURE_NOT_IN_PLAN_MESSAGE, hasFeature } from '@services/entitlements/feature-trial.service';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';
import { Op } from 'sequelize';

type CodeInput = string | null | undefined;

/**
 * Splits `codes` into the currencies a user may use and the codes they may not.
 *
 * A code is usable when it names an ISO 4217 row, or a custom row the user holds in their own
 * currency list. Another user's custom code is reported as rejected exactly like an unknown one, so
 * the answer never reveals that the code exists.
 */
export const resolveVisibleCurrencies = async ({
  userId,
  codes,
}: {
  userId: number;
  codes: readonly CodeInput[];
}): Promise<{ visible: Currencies[]; rejected: string[] }> => {
  const requested = [
    ...new Set(codes.filter((code): code is string => Boolean(code)).map((code) => normalizeCurrencyCode(code))),
  ];

  if (!requested.length) return { visible: [], rejected: [] };

  const rows = await Currencies.findAll({ where: { code: { [Op.in]: requested } } });

  const customCodes = rows.filter((row) => row.isCustom).map((row) => row.code);
  const heldCustomCodes = new Set<string>();

  if (customCodes.length) {
    const held = await UsersCurrencies.findAll({
      where: { userId, currencyCode: { [Op.in]: customCodes } },
      attributes: ['currencyCode'],
      raw: true,
    });
    held.forEach((row) => heldCustomCodes.add(row.currencyCode));
  }

  const visible = rows.filter((row) => !row.isCustom || heldCustomCodes.has(row.code));
  const visibleCodes = new Set(visible.map((row) => row.code));

  return { visible, rejected: requested.filter((code) => !visibleCodes.has(code)) };
};

/** Codes of the custom currencies in the user's own list, for error messages that name the valid choices. */
export const getOwnCustomCurrencyCodes = async ({ userId }: { userId: number }): Promise<string[]> => {
  const held = await UsersCurrencies.findAll({
    where: { userId },
    include: [{ model: Currencies, as: 'currency', attributes: [], where: { isCustom: true }, required: true }],
    attributes: ['currencyCode'],
    raw: true,
  });

  return held.map((row) => row.currencyCode).toSorted();
};

/** The message for a rejected code. It names the choices the user has: ISO 4217 codes, plus their own custom codes. */
export const buildInvalidCurrencyMessage = ({
  code,
  ownCustomCodes,
}: {
  code: string;
  ownCustomCodes: readonly string[];
}): string => {
  if (!isCurrencyCodeFormat(code)) return t({ key: 'currencies.invalidCode', variables: { code } });

  return ownCustomCodes.length
    ? t({ key: 'currencies.invalidCodeWithCustom', variables: { code, customCodes: ownCustomCodes.join(', ') } })
    : t({ key: 'currencies.invalidCodeIso', variables: { code } });
};

/**
 * Throws `ValidationError` (422) for the first code the user may not use; `null` and `undefined`
 * entries are skipped, so optional fields pass straight in. See `resolveVisibleCurrencies` for the
 * visibility rule.
 *
 * A custom code then needs the custom currencies plan (402), except the ones in `allowedWithoutPlan`:
 * every code on a read or a transaction write, the codes an edited row already stores.
 *
 * Run it before any code reaches a foreign key, `ensureUserCurrencyConnected` or an exchange-rate
 * lookup: the request schema only checks the shape of the code.
 */
export const assertCurrencyCodesVisible = async ({
  userId,
  codes,
  allowedWithoutPlan = [],
}: {
  userId: number;
  codes: readonly CodeInput[];
  allowedWithoutPlan?: readonly CodeInput[];
}): Promise<void> => {
  const { visible, rejected } = await resolveVisibleCurrencies({ userId, codes });

  const [firstRejected] = rejected;
  if (firstRejected !== undefined) {
    const ownCustomCodes = await getOwnCustomCurrencyCodes({ userId });

    throw new ValidationError({
      message: buildInvalidCurrencyMessage({ code: firstRejected, ownCustomCodes }),
      details: { rejectedCodes: rejected },
    });
  }

  const allowed = new Set(allowedWithoutPlan.filter(Boolean).map((code) => normalizeCurrencyCode(code!)));
  if (
    visible.some((row) => row.isCustom && !allowed.has(row.code)) &&
    !hasFeature({ entitlements: await getEntitlementsByUserId({ userId }), feature: FEATURES.custom_currencies })
  ) {
    throw new PlanRequiredError({ message: FEATURE_NOT_IN_PLAN_MESSAGE });
  }
};
