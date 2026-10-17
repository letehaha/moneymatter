import { describe, expect, it } from '@jest/globals';
import { Column, DataType, Model, Sequelize, Table } from 'sequelize-typescript';

import { Money } from './money';
import { MoneyField, toMoneyColumnValue } from './money-column';

@Table({ tableName: 'MoneyColumnUnitFixtures', timestamps: false })
class DecimalFixture extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true })
  declare id: number;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18 })
  declare amount: Money;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, allowNull: true })
  declare optionalAmount: Money | null;
}

// Building the instance registers the models without opening a connection.
new Sequelize({
  dialect: 'postgres',
  models: [DecimalFixture],
  logging: false,
});

describe('@MoneyField decimal storage', () => {
  it('stores a Money value with every decimal it carries, padded to the column scale', () => {
    const row = DecimalFixture.build({ id: 1 });

    row.amount = Money.fromDecimal('0.00040641');

    expect(row.getDataValue('amount')).toBe('0.000406410000000000');
    expect(row.amount.toDecimalString(8)).toBe('0.00040641');
  });

  it('does not round to the 2 decimals of a cent', () => {
    const row = DecimalFixture.build({ id: 1 });

    row.amount = Money.fromDecimal('1.005');
    expect(row.getDataValue('amount')).toBe('1.005000000000000000');

    row.amount = Money.fromDecimal('-12.3456');
    expect(row.amount.toNumber()).toBe(-12.3456);
  });

  it('passes raw numbers and decimal strings through unchanged', () => {
    const row = DecimalFixture.build({ id: 1 });

    row.amount = 12.176673309 as unknown as Money;
    expect(row.amount.toNumber()).toBe(12.176673309);

    row.amount = '0.125' as unknown as Money;
    expect(row.getDataValue('amount')).toBe('0.125');
  });

  it('stores null as null', () => {
    const row = DecimalFixture.build({ id: 1 });

    row.optionalAmount = null;

    expect(row.getDataValue('optionalAmount')).toBeNull();
  });
});

describe('toMoneyColumnValue', () => {
  it('writes the exact string the setter stores', () => {
    const row = DecimalFixture.build({ id: 1 });
    const money = Money.fromDecimal('12.345');

    row.amount = money;

    expect(toMoneyColumnValue({ money })).toBe(row.getDataValue('amount'));
    expect(toMoneyColumnValue({ money })).toBe('12.345000000000000000');
  });

  it('keeps the sign and pads to the column scale', () => {
    expect(toMoneyColumnValue({ money: Money.fromDecimal(-0.5) })).toBe('-0.500000000000000000');
    expect(toMoneyColumnValue({ money: Money.zero() })).toBe('0.000000000000000000');
  });
});
