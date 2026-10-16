import { describe, expect, it } from '@jest/globals';
import { Column, DataType, Model, Sequelize, Table } from 'sequelize-typescript';

import { Money } from './money';
import { MoneyField } from './money-column';

@Table({ tableName: 'MoneyColumnUnitFixtures', timestamps: false })
class RoundedFixture extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true })
  declare id: number;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2 })
  declare amount: Money;

  @MoneyField({
    storage: 'decimal',
    precision: 36,
    scale: 18,
    roundOnWrite: 2,
    allowNull: true,
  })
  declare optionalAmount: Money | null;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18 })
  declare exactAmount: Money;
}

// Building the instance registers the models without opening a connection.
new Sequelize({
  dialect: 'postgres',
  models: [RoundedFixture],
  logging: false,
});

describe('@MoneyField decimal storage', () => {
  describe('roundOnWrite', () => {
    it('rounds a Money value half-up to the given decimals before storing it', () => {
      const row = RoundedFixture.build({ id: 1 });

      row.amount = Money.fromDecimal('1.005');
      expect(row.getDataValue('amount')).toBe('1.010000000000000000');

      row.amount = Money.fromDecimal('-1.005');
      expect(row.getDataValue('amount')).toBe('-1.010000000000000000');

      row.amount = Money.fromDecimal('12.344');
      expect(row.amount.toNumber()).toBe(12.34);
    });

    it('rounds raw numbers and decimal strings the same way', () => {
      const row = RoundedFixture.build({ id: 1 });

      row.amount = 12.176673309 as unknown as Money;
      expect(row.amount.toNumber()).toBe(12.18);

      row.amount = '0.125' as unknown as Money;
      expect(row.getDataValue('amount')).toBe('0.130000000000000000');
    });

    it('stores null as null', () => {
      const row = RoundedFixture.build({ id: 1 });

      row.optionalAmount = null;

      expect(row.getDataValue('optionalAmount')).toBeNull();
    });

    it('keeps every decimal when the option is absent', () => {
      const row = RoundedFixture.build({ id: 1 });

      row.exactAmount = Money.fromDecimal('0.00040641');

      expect(row.getDataValue('exactAmount')).toBe('0.000406410000000000');
      expect(row.exactAmount.toDecimalString(8)).toBe('0.00040641');
    });
  });
});
