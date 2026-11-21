import { CUSTOM_CURRENCY_DECIMALS_MAX, CUSTOM_CURRENCY_DECIMALS_MIN, RecordId } from '@bt/shared/types';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { invalidateCurrencyDecimalsCache } from '@common/lib/currency-decimals-cache';
import { IdColumn } from '@common/types/id-column';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { UnexpectedError, ValidationError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import { Op } from 'sequelize';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, AfterSave, AfterDestroy } from 'sequelize-typescript';

import Currencies, { NON_CURRENCY_CODES } from './currencies.model';
import Users from './users.model';

@Table({
  timestamps: false,
  tableName: 'UsersCurrencies',
  freezeTableName: true,
})
export default class UsersCurrencies extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({ allowNull: false, type: DataType.INTEGER })
  userId!: number;

  @ForeignKey(() => Currencies)
  @Column({ allowNull: false, type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH) })
  currencyCode!: string;

  @BelongsTo(() => Users, {
    as: 'user',
    foreignKey: 'userId',
  })
  @BelongsTo(() => Currencies, {
    as: 'currency',
    foreignKey: 'currencyCode',
  })

  // Since base currency is always the same, here we're setting exchange rate
  // between currencyCode to user's base currency
  // TODO: probably deprecated?
  @Column({
    allowNull: true,
    defaultValue: null,
    type: DataType.INTEGER,
  })
  exchangeRate!: number;

  @Column({
    allowNull: false,
    defaultValue: false,
    type: DataType.BOOLEAN,
  })
  liveRateUpdate!: boolean;

  @Column({
    allowNull: false,
    defaultValue: false,
    type: DataType.BOOLEAN,
  })
  isDefaultCurrency!: boolean;

  /** Name of a custom currency as this user defines it; `null` on an ISO row. */
  @Column({ allowNull: true, defaultValue: null, type: DataType.STRING(255) })
  nameOverride!: string | null;

  /** Symbol of a custom currency as this user defines it; `null` for none and on an ISO row. */
  @Column({ allowNull: true, defaultValue: null, type: DataType.STRING(8) })
  symbolOverride!: string | null;

  /** Decimals of a custom currency as this user defines it; `null` on an ISO row, which keeps "Currencies"."digits". */
  @Column({
    allowNull: true,
    defaultValue: null,
    type: DataType.INTEGER,
    validate: { min: CUSTOM_CURRENCY_DECIMALS_MIN, max: CUSTOM_CURRENCY_DECIMALS_MAX },
  })
  decimalsOverride!: number | null;

  /** https URL of the image the user picked for a custom currency; `null` draws a monogram. Always `null` on an ISO row. */
  @Column({ allowNull: true, defaultValue: null, type: DataType.TEXT })
  logoUrl!: string | null;

  // Cached decimals (`getCurrencyDecimals`) read `decimalsOverride`, so any change to a row drops them.
  @AfterSave
  @AfterDestroy
  static invalidateDecimalsCacheForRow(instance: UsersCurrencies) {
    invalidateCurrencyDecimalsCache({ userId: instance.userId, code: instance.currencyCode });
  }
}

export async function getCurrencies({ userId, codes }: { userId: number; codes?: string[] }) {
  const where: Record<string, unknown> = {
    userId,
  };

  if (codes) where.currencyCode = { [Op.in]: codes };

  return UsersCurrencies.findAll({
    where,
    include: { model: Currencies },
    raw: true,
    nest: true,
  });
}

export const getBaseCurrency = async ({ userId }: { userId: number }) => {
  const data = (await UsersCurrencies.findOne({
    where: { userId, isDefaultCurrency: true },
    include: { model: Currencies },
  })) as UsersCurrencies & { currency: Currencies };

  return data;
};

type getCurrencyOverload = {
  ({
    userId,
    currencyCode,
  }: {
    userId: number;
    currencyCode: string;
  }): Promise<UsersCurrencies & { currency: Currencies }>;
  ({
    userId,
    isDefaultCurrency,
  }: {
    userId: number;
    isDefaultCurrency: boolean;
  }): Promise<UsersCurrencies & { currency: Currencies }>;
};
export const getCurrency: getCurrencyOverload = ({
  userId,
  currencyCode,
  isDefaultCurrency,
}: {
  userId: number;
  currencyCode?: string;
  isDefaultCurrency?: boolean;
}) => {
  return UsersCurrencies.findOne({
    where: removeUndefinedKeys({ userId, currencyCode, isDefaultCurrency }),
    include: {
      model: Currencies,
    },
  }) as Promise<UsersCurrencies & { currency: Currencies }>;
};

export const addCurrency = async ({
  userId,
  currencyCode,
  exchangeRate,
  liveRateUpdate = true,
  isDefaultCurrency,
}: {
  userId: number;
  currencyCode: string;
  exchangeRate?: number;
  liveRateUpdate?: boolean;
  isDefaultCurrency?: boolean;
}) => {
  const currency = await findOrThrowNotFound({
    query: Currencies.findByPk(currencyCode),
    message: 'Currency with provided code does not exist!',
  });

  const existingCurrency = await UsersCurrencies.findOne({
    where: { userId, currencyCode },
    raw: true,
  });
  if (existingCurrency) return existingCurrency;

  if (currency.isCustom) {
    throw new UnexpectedError({
      message: `addCurrency cannot hold the custom currency ${currencyCode}; use createCustomCurrency or ensureUserCurrencyConnected`,
    });
  }

  if (NON_CURRENCY_CODES.includes(currencyCode)) {
    throw new ValidationError({
      message: t({ key: 'csvImport.currencyNotSupported', variables: { currency: currencyCode } }),
    });
  }

  return UsersCurrencies.create(
    {
      userId,
      currencyCode,
      exchangeRate,
      liveRateUpdate,
      isDefaultCurrency,
    },
    {
      returning: true,
      raw: true,
    },
  );
};

export const updateCurrency = async ({
  userId,
  currencyCode,
  exchangeRate,
  liveRateUpdate,
  isDefaultCurrency,
}: {
  userId: number;
  currencyCode: string;
  exchangeRate?: number;
  liveRateUpdate?: boolean;
  isDefaultCurrency?: boolean;
}) => {
  const where = { userId, currencyCode };

  await UsersCurrencies.update(
    {
      exchangeRate,
      liveRateUpdate,
      isDefaultCurrency,
    },
    {
      where,
    },
  );

  const currency = await getCurrency(where);

  return currency;
};

export const deleteCurrency = async ({ userId, currencyCode }: { userId: number; currencyCode: string }) => {
  const where = { userId, currencyCode };

  return UsersCurrencies.destroy({
    where,
  });
};

export const updateCurrencies = async ({
  userId,
  currencyCodes,
  exchangeRate,
  liveRateUpdate,
  isDefaultCurrency,
}: {
  userId: number;
  currencyCodes?: string[];
  exchangeRate?: number;
  liveRateUpdate?: boolean;
  isDefaultCurrency?: boolean;
}) => {
  const where: {
    userId: number;
    currencyCode?: { [Op.in]: string[] };
  } = { userId };

  if (currencyCodes?.length) {
    where.currencyCode = {
      [Op.in]: currencyCodes,
    };
  }

  await UsersCurrencies.update(
    {
      exchangeRate,
      liveRateUpdate,
      isDefaultCurrency,
    },
    {
      where,
    },
  );

  return UsersCurrencies.findAll({
    where,
  });
};
