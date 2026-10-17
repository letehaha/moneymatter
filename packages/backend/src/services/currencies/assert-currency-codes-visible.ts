import { CURRENCY_CODE_PATTERN } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import UsersCurrencies from '@models/users-currencies.model';
import { Op } from 'sequelize';

type CodeInput = string | null | undefined;

/**
 * Splits `codes` into the currencies a user may use and the codes they may not.
 *
 * A code is usable when it names an ISO 4217 row, or a custom row the user holds in their own
 * currency list. Another user's custom code is reported as rejected exactly like an unknown one, so
 * the answer never reveals that the code exists. With `isoOnly` a custom code is rejected even when
 * the user holds it, for contexts that keep ISO-only validation (portfolios, securities).
 */
export const resolveVisibleCurrencies = async ({
  userId,
  codes,
  isoOnly = false,
}: {
  userId: number;
  codes: readonly CodeInput[];
  isoOnly?: boolean;
}): Promise<{ visible: Currencies[]; rejected: string[] }> => {
  const requested = [
    ...new Set(codes.filter((code): code is string => Boolean(code)).map((code) => code.trim().toUpperCase())),
  ];

  if (!requested.length) return { visible: [], rejected: [] };

  const rows = await Currencies.findAll({ where: { code: { [Op.in]: requested } } });

  const customCodes = rows.filter((row) => row.isCustom).map((row) => row.code);
  const heldCustomCodes = new Set<string>();

  if (customCodes.length && !isoOnly) {
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

  return held.map((row) => row.currencyCode).sort();
};

/**
 * The message for a rejected code. It names the choices the user has: ISO 4217 codes, plus their
 * own custom codes unless the context is ISO-only.
 */
export const buildInvalidCurrencyMessage = ({
  code,
  ownCustomCodes,
}: {
  code: string;
  ownCustomCodes: readonly string[];
}): string => {
  if (!CURRENCY_CODE_PATTERN.test(code)) {
    return `Invalid currency code "${code}". Use 2 to 16 letters or digits, e.g. "USD".`;
  }

  return ownCustomCodes.length
    ? `Invalid currency code "${code}". Use an ISO 4217 code, e.g. "USD", or one of your custom currencies: ${ownCustomCodes.join(', ')}.`
    : `Invalid currency code "${code}". Use an ISO 4217 code, e.g. "USD".`;
};

/**
 * Throws `ValidationError` (422) for the first code the user may not use; `null` and `undefined`
 * entries are skipped, so optional fields pass straight in. See `resolveVisibleCurrencies` for the
 * visibility rule.
 *
 * Run it before any code reaches a foreign key, `ensureUserCurrencyConnected` or an exchange-rate
 * lookup: the request schema only checks the shape of the code.
 */
export const assertCurrencyCodesVisible = async ({
  userId,
  codes,
  isoOnly = false,
}: {
  userId: number;
  codes: readonly CodeInput[];
  isoOnly?: boolean;
}): Promise<void> => {
  const { rejected } = await resolveVisibleCurrencies({ userId, codes, isoOnly });

  const [firstRejected] = rejected;
  if (firstRejected === undefined) return;

  const ownCustomCodes = isoOnly ? [] : await getOwnCustomCurrencyCodes({ userId });

  throw new ValidationError({
    message: buildInvalidCurrencyMessage({ code: firstRejected, ownCustomCodes }),
    details: { rejectedCodes: rejected },
  });
};
