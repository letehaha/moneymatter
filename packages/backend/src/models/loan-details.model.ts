import { LOAN_TYPE, type LoanEvent, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import Accounts from '@models/accounts.model';
import Users from '@models/users.model';
import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'LoanDetails',
  timestamps: true,
  freezeTableName: true,
})
export default class LoanDetails extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Accounts)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    unique: true,
  })
  accountId!: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
    validate: { isIn: [Object.values(LOAN_TYPE)] },
  })
  loanType!: LOAN_TYPE;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2 })
  declare originalPrincipal: Money;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2 })
  declare refOriginalPrincipal: Money;

  // Postgres returns DECIMAL columns as strings; parse at the model boundary
  // so every consumer sees a number and no call site needs its own `Number()`.
  @Column({
    type: DataType.DECIMAL(7, 4),
    allowNull: false,
  })
  get interestRate(): number {
    return Number(this.getDataValue('interestRate'));
  }
  set interestRate(val: number | string) {
    this.setDataValue('interestRate', typeof val === 'number' ? val.toFixed(4) : val);
  }

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  termMonths!: number | null;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
  })
  startDate!: string;

  // Date the outstanding balance (Account.initialBalance) is asserted as-of;
  // distinct from startDate, the contractual origination date, which never moves.
  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
  })
  balanceAnchorDate!: string;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2, allowNull: true })
  declare minPayment: Money | null;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2, allowNull: true })
  declare refMinPayment: Money | null;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2, allowNull: true })
  declare plannedPayment: Money | null;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2, allowNull: true })
  declare refPlannedPayment: Money | null;

  @Column({
    type: DataType.SMALLINT,
    allowNull: true,
  })
  paymentDayOfMonth!: number | null;

  @Column({
    type: DataType.STRING(200),
    allowNull: true,
  })
  lenderName!: string | null;

  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  accountNumber!: string | null;

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
  })
  events!: LoanEvent[];

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Accounts, { foreignKey: 'accountId' })
  account!: Accounts;

  @BelongsTo(() => Users)
  user!: Users;
}
