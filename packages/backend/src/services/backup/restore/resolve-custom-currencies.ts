import type { CurrencyRateSourceSetting } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { customCurrencyDefinitionSchema } from '@common/lib/zod/custom-currency-schemas';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Currencies, { customCurrencyStub } from '@models/currencies.model';
import { EMPTY_LOGO_FIELDS } from '@root/serializers/logo-fields.serializer';
import { insertOrAdopt } from '@services/common/run-in-savepoint';
import {
  coingeckoRateSourceConfigSchema,
  pegRateSourceConfigSchema,
  storedHttpRateSourceConfigSchema,
} from '@services/currencies/rate-sources';
import cc from 'currency-codes';
import { Op, type Transaction } from 'sequelize';

import type { ParsedArchive } from './load-archive';

export interface CustomCurrencyDefinition {
  code: string;
  name: string;
  decimals: number;
  symbol: string | null;
  rateSourceSetting: CurrencyRateSourceSetting;
  /** An HTTP source whose header names came in the archive: their values never travel. */
  headersDropped: boolean;
}

/**
 * A custom row's rate source, validated: every quote an ISO code. A row from an archive written
 * before rate sources has none and is on its own rates (`manual`).
 */
const readRateSourceSetting = ({
  row,
  isoCodes,
}: {
  row: Record<string, unknown>;
  isoCodes: Set<string>;
}): CurrencyRateSourceSetting | null => {
  const config = row.rateSourceConfig;
  switch (row.rateSource ?? 'manual') {
    case 'manual':
      return { rateSource: 'manual', rateSourceConfig: null };
    case 'peg': {
      const parsed = pegRateSourceConfigSchema.safeParse(config);
      return parsed.success && isoCodes.has(parsed.data.pegCurrency)
        ? { rateSource: 'peg', rateSourceConfig: parsed.data }
        : null;
    }
    case 'coingecko': {
      const parsed = coingeckoRateSourceConfigSchema.safeParse(config);
      return parsed.success && isoCodes.has(parsed.data.quoteCurrency)
        ? { rateSource: 'coingecko', rateSourceConfig: parsed.data }
        : null;
    }
    case 'http': {
      const parsed = storedHttpRateSourceConfigSchema.safeParse(config);
      return parsed.success && isoCodes.has(parsed.data.quoteCurrency)
        ? { rateSource: 'http', rateSourceConfig: parsed.data }
        : null;
    }
    default:
      return null;
  }
};

/**
 * Custom definitions are the `users-currencies` rows with a name or decimals override; 422 unless each
 * has a valid rate source, rates that quote ISO codes only, and a value: a peg, or a positive rate of
 * its own. Rates quoted in a custom currency are dropped (the resolver derives them from the custom
 * currency's own rates), and an unheld quote (a collaborator's copy) gets a holding added.
 */
export const readCustomCurrencyDefinitions = ({
  archive,
  isoCodes,
}: {
  archive: ParsedArchive;
  isoCodes: Set<string>;
}): Map<string, CustomCurrencyDefinition> => {
  const holdings = archive.data.get('users-currencies') ?? [];
  const definitions = new Map<string, CustomCurrencyDefinition>();
  const rowByCode = new Map<string, Record<string, unknown>>();

  for (const row of holdings) {
    if (row.nameOverride == null && row.decimalsOverride == null) continue;

    const code = String(row.currencyCode);
    if (isoCodes.has(code) || cc.code(code) !== undefined) {
      throw new ValidationError({ message: t({ key: 'currencies.customCurrencyIsoCode', variables: { code } }) });
    }
    if (definitions.has(code)) {
      throw new ValidationError({
        message: t({ key: 'currencies.customCurrencyAlreadyDefined', variables: { code } }),
      });
    }
    if (row.isDefaultCurrency) {
      throw new ValidationError({ message: t({ key: 'currencies.customCurrencyCannotBeBase', variables: { code } }) });
    }

    const parsed = customCurrencyDefinitionSchema.safeParse({
      code,
      name: row.nameOverride,
      decimals: row.decimalsOverride,
      symbol: row.symbolOverride,
    });
    if (!parsed.success) {
      throw new ValidationError({
        message: t({ key: 'backup.restore.errors.customCurrencyInvalid', variables: { code } }),
      });
    }

    const rateSourceSetting = readRateSourceSetting({ row, isoCodes });
    if (!rateSourceSetting) {
      throw new ValidationError({
        message: t({ key: 'backup.restore.errors.customCurrencyInvalid', variables: { code } }),
      });
    }

    const headersDropped =
      rateSourceSetting.rateSource === 'http' && rateSourceSetting.rateSourceConfig.headerNames.length > 0;
    if (rateSourceSetting.rateSource === 'http') rateSourceSetting.rateSourceConfig.headerNames = [];

    const { name, decimals, symbol } = parsed.data;
    definitions.set(code, { code, name, decimals, symbol: symbol ?? null, rateSourceSetting, headersDropped });
    rowByCode.set(code, row);
  }

  const archivedRates = archive.data.get('user-exchange-rates') ?? [];
  const customPair = archivedRates.find(
    (rate) => definitions.has(String(rate.baseCode)) && definitions.has(String(rate.quoteCode)),
  );
  if (customPair) {
    throw new ValidationError({
      message: t({
        key: 'currencies.customCurrencyRateBetweenCustom',
        variables: { baseCode: String(customPair.baseCode), quoteCode: String(customPair.quoteCode) },
      }),
    });
  }

  const rates = archivedRates.filter((rate) => !definitions.has(String(rate.quoteCode)));
  archive.data.set('user-exchange-rates', rates);

  const heldIsoCodes = new Set(holdings.map((row) => String(row.currencyCode)).filter((code) => isoCodes.has(code)));

  for (const [code, { rateSourceSetting }] of definitions) {
    const own = rates.filter((rate) => rate.baseCode === code);
    const quotes = new Set(own.map((rate) => String(rate.quoteCode)));
    const priced = rateSourceSetting.rateSource === 'peg' || own.some((rate) => Number(rate.rate) > 0);

    if ([...quotes].some((quote) => !isoCodes.has(quote)) || !priced) {
      throw new ValidationError({
        message: t({ key: 'backup.restore.errors.customCurrencyWithoutRate', variables: { code } }),
      });
    }

    for (const quote of quotes) {
      if (heldIsoCodes.has(quote)) continue;
      holdings.push({
        ...rowByCode.get(code),
        id: generateRandomRecordId(),
        currencyCode: quote,
        exchangeRate: null,
        liveRateUpdate: true,
        isDefaultCurrency: false,
        nameOverride: null,
        symbolOverride: null,
        decimalsOverride: null,
        ...EMPTY_LOGO_FIELDS,
      });
      heldIsoCodes.add(quote);
    }
  }

  return definitions;
};

/**
 * Ensures a global stub row exists for each of the backup's custom codes. Runs inside the restore
 * transaction, so a failed restore leaves no stub behind.
 */
export const restoreCustomCurrencies = async ({
  codes,
  transaction,
}: {
  codes: string[];
  transaction: Transaction;
}): Promise<void> => {
  if (!codes.length) return;

  // FOR SHARE, as `createCustomCurrency` takes: `pruneUnusedCustomCurrencies` must not delete a stub
  // before the restored holding lands. Ordered by code, the order the prune locks in.
  const lock = transaction.LOCK.SHARE;
  const existing = await Currencies.findAll({
    where: { code: { [Op.in]: codes } },
    attributes: ['code', 'isCustom'],
    order: [['code', 'ASC']],
    transaction,
    lock,
  });
  const existingByCode = new Map(existing.map((row) => [row.code, row]));

  for (const code of codes) {
    // Another restore or user may define the same new code at the same moment; the loser adopts the winner's row.
    const row =
      existingByCode.get(code) ??
      (await insertOrAdopt({
        insert: () => Currencies.create(customCurrencyStub({ code }), { transaction }),
        adopt: () => Currencies.findOne({ where: { code }, transaction, lock }),
      }));

    if (!row.isCustom) {
      throw new ValidationError({ message: t({ key: 'currencies.customCurrencyIsoCode', variables: { code } }) });
    }
  }
};
