import { invalidateCurrencyDecimalsCache } from '@common/lib/currency-decimals-cache';
import { ValidationError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import { Op } from 'sequelize';
import {
  Table,
  Column,
  Model,
  BelongsToMany,
  DataType,
  AfterSave,
  AfterDestroy,
  AfterBulkUpdate,
  AfterBulkDestroy,
} from 'sequelize-typescript';

import UsersCurrencies from './users-currencies.model';
import Users from './users.model';

@Table({
  timestamps: false,
  tableName: 'Currencies',
  freezeTableName: true,
})
export default class Currencies extends Model {
  @Column({
    allowNull: false,
    primaryKey: true,
    type: DataType.STRING(3),
  })
  code!: string;

  @Column({
    allowNull: false,
    type: DataType.STRING,
  })
  currency!: string;

  @Column({
    allowNull: false,
    type: DataType.INTEGER,
  })
  digits!: number;

  @Column({
    allowNull: false,
    type: DataType.INTEGER,
  })
  number!: number;

  @BelongsToMany(() => Users, {
    as: 'users',
    through: () => UsersCurrencies,
  })

  @Column({ allowNull: false, defaultValue: false, type: DataType.BOOLEAN })
  isDisabled!: boolean;

  // Cached decimals (`getCurrencyDecimals`) derive from `digits`, so any change to a row drops them.
  @AfterSave
  @AfterDestroy
  static invalidateDecimalsCacheForRow(instance: Currencies) {
    invalidateCurrencyDecimalsCache({ code: instance.code });
  }

  @AfterBulkUpdate
  @AfterBulkDestroy
  static invalidateDecimalsCacheForBulk() {
    invalidateCurrencyDecimalsCache();
  }
}

/**
 * ISO 4217 codes that are not actual currencies (precious metals, testing codes, supranational
 * currencies, accounting fund codes). These are excluded from the currency selection UI and rejected
 * on bank-account import — none of them have an exchange rate, so trying to compute a ref-amount
 * against the user's base currency throws. They are also excluded from `getAllCurrencies`, which
 * feeds the exchange-rate sync's coverage checks: treating them as expected would make full coverage
 * permanently unreachable (no provider quotes them), defeating the ApiLayer early-stop and making
 * the coverage alerts fire on every sync.
 */
export const NON_CURRENCY_CODES = [
  'XAU', // Gold
  'XAG', // Silver
  'XPT', // Platinum
  'XPD', // Palladium
  'XBA', // European Composite Unit (EURCO)
  'XBB', // European Monetary Unit (E.M.U.-6)
  'XBC', // European Unit of Account 9 (E.U.A.-9)
  'XBD', // European Unit of Account 17 (E.U.A.-17)
  'XDR', // Special Drawing Rights
  'XSU', // Sucre
  'XUA', // ADB Unit of Account
  'XXX', // No currency
  'XTS', // Testing code
  'BOV', // Bolivian Mvdol (funds code)
  'CHE', // WIR euro (complementary currency)
  'CHW', // WIR franc (complementary currency)
  'COU', // Colombian unidad de valor real (funds code)
  'MXV', // Mexican unidad de inversión (funds code)
  'USN', // US dollar next-day (funds code)
  'UYI', // Uruguay peso en unidades indexadas (funds code)
  'UYW', // Uruguayan unidad previsional (funds code)
];

export const getAllCurrencies = async () => {
  const currencies = await Currencies.findAll({
    where: {
      isDisabled: { [Op.not]: true },
      code: { [Op.notIn]: NON_CURRENCY_CODES },
    },
  });

  return currencies;
};

export async function getCurrency({ currency }: { currency: string }): Promise<Currencies | null>;
export async function getCurrency({ number }: { number: number }): Promise<Currencies | null>;
export async function getCurrency({ code }: { code: string }): Promise<Currencies | null>;
export async function getCurrency({
  currency,
  number,
  code,
}: {
  currency?: string;
  number?: number;
  code?: string;
}): Promise<Currencies | null> {
  return Currencies.findOne({
    where: removeUndefinedKeys({ currency, number, code }),
    include: [{ model: Users }],
  });
}

export async function getCurrencies({
  currencies,
  numbers,
  codes,
}: {
  numbers?: number[];
  currencies?: string[];
  codes?: string[];
}) {
  if (currencies === undefined && codes === undefined && numbers === undefined) {
    throw new ValidationError({
      message: 'Neither "currencies", "codes" or "numbers" should be specified.',
    });
  }
  const where: Record<string, unknown> = {
    isDisabled: { [Op.not]: true },
  };

  if (currencies) where.currency = { [Op.in]: currencies };
  if (codes) where.code = { [Op.in]: codes };
  if (numbers) where.number = { [Op.in]: numbers };

  return Currencies.findAll({ where });
}
