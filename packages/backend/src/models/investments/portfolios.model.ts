import { RecordId } from '@bt/shared/types';
import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
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
  @Column({ type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH), allowNull: true })
  displayCurrencyCode!: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  isEnabled!: boolean;

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
