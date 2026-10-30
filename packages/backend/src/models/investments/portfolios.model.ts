import { RecordId } from '@bt/shared/types';
import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany, Index } from 'sequelize-typescript';

import Users from '../users.model';
import Holdings from './holdings.model';
import InvestmentTransaction from './investment-transaction.model';
import PortfolioBalances from './portfolio-balances.model';

@Table({
  timestamps: true,
  paranoid: true,
  tableName: 'Portfolios',
})
export default class Portfolios extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @ForeignKey(() => Users)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @Index
  @Column({
    type: DataType.ENUM(...Object.values(PORTFOLIO_TYPE)),
    allowNull: false,
    defaultValue: PORTFOLIO_TYPE.investment,
  })
  portfolioType!: PORTFOLIO_TYPE;

  @Column({ type: DataType.TEXT, allowNull: true })
  description!: string | null;

  /**
   * Currency the portfolio's summary/stats are converted to for display (e.g. PLN to match a Polish broker).
   * Display-only — stored ref* values stay in base currency. Null means the user's base currency.
   */
  @Column({ type: DataType.STRING(3), allowNull: true })
  displayCurrencyCode!: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  isEnabled!: boolean;

  @Column({ type: DataType.STRING(253), allowNull: true })
  logoDomain!: string | null;

  @Column({ type: DataType.STRING(16), allowNull: true })
  logoInitials!: string | null;

  @Column({ type: DataType.STRING(7), allowNull: true })
  logoColor!: string | null;

  @Column({ type: DataType.STRING(64), allowNull: true })
  logoIcon!: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  logoImageId!: string | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare deletedAt: Date | null;

  // Associations
  @BelongsTo(() => Users)
  user?: Users;

  @HasMany(() => PortfolioBalances)
  balances?: PortfolioBalances[];

  @HasMany(() => Holdings)
  holdings?: Holdings[];

  @HasMany(() => InvestmentTransaction)
  investmentTransactions?: InvestmentTransaction[];
}
