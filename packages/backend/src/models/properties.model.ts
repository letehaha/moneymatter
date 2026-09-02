import { PROPERTY_TYPE, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import Accounts from '@models/accounts.model';
import Users from '@models/users.model';
import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'Properties',
  timestamps: true,
  freezeTableName: true,
})
export default class Properties extends Model {
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

  /** Optional mortgage link. Points at a loan-category account owned by the same user. */
  @ForeignKey(() => Accounts)
  @Column({
    type: DataType.UUID,
    allowNull: true,
    unique: true,
  })
  loanAccountId!: RecordId | null;

  @Column({
    type: DataType.STRING(500),
    allowNull: false,
  })
  address!: string;

  @Column({
    type: DataType.STRING(120),
    allowNull: true,
  })
  city!: string | null;

  @Column({
    type: DataType.STRING(120),
    allowNull: true,
  })
  country!: string | null;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: PROPERTY_TYPE.house,
  })
  propertyType!: PROPERTY_TYPE;

  @Column({
    type: DataType.SMALLINT,
    allowNull: true,
  })
  yearBuilt!: number | null;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  notes!: string | null;

  @MoneyField({ storage: 'cents' })
  declare purchasePrice: Money;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
  })
  purchaseDate!: string;

  @MoneyField({ storage: 'cents', allowNull: true })
  declare valueAnchor: Money | null;

  @Column({
    type: DataType.DATEONLY,
    allowNull: true,
  })
  valueAnchorDate!: string | null;

  @Column({
    type: DataType.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 3,
  })
  annualAppreciationRatePct!: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  valueLastComputedAt!: Date | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Accounts, { foreignKey: 'accountId', as: 'account' })
  account!: Accounts;

  @BelongsTo(() => Accounts, { foreignKey: 'loanAccountId', as: 'loanAccount' })
  loanAccount!: Accounts | null;

  @BelongsTo(() => Users)
  user!: Users;
}
