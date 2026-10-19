import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, HasMany, BelongsToMany, DataType } from 'sequelize-typescript';
// AccountGroup.model.ts

import Accounts from '../accounts.model';
import BankDataProviderConnections from '../bank-data-provider-connections.model';
import Users from '../users.model';
import AccountGrouping from './account-grouping.model';

/**
 * This model represents a group of accounts. It allows users to organize their accounts
 * into hierarchical groups (folders). Each group belongs to a user and can have
 * a parent group, enabling multi-level organization.
 *
 * Key features:
 * - Belongs to a user
 * - Can have a parent group (for nested groups)
 * - Can have multiple child groups
 * - Associated with multiple accounts through AccountGrouping
 */

@Table({
  tableName: 'AccountGroups',
  timestamps: true,
  freezeTableName: true,
})
export default class AccountGroup extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  name!: string;

  @ForeignKey(() => AccountGroup)
  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  parentGroupId!: RecordId | null;

  @ForeignKey(() => BankDataProviderConnections)
  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  bankDataProviderConnectionId!: RecordId | null;

  @Column({
    type: DataType.STRING(253),
    allowNull: true,
  })
  logoDomain!: string | null;

  // 1-2 graphemes rendered as a monogram instead of a logo.dev image. 16 chars
  // because one grapheme can span many code points; the count is enforced in Zod.
  @Column({
    type: DataType.STRING(16),
    allowNull: true,
  })
  logoInitials!: string | null;

  // '#rrggbb' lowercase, the monogram background. Only meaningful alongside
  // logoInitials; null there falls back to the primary tint.
  @Column({
    type: DataType.STRING(7),
    allowNull: true,
  })
  logoColor!: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
  })
  logoIcon!: string | null;

  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  logoImageId!: string | null;

  @BelongsTo(() => Users)
  user!: Users;

  @BelongsTo(() => BankDataProviderConnections)
  bankDataProviderConnection!: BankDataProviderConnections;

  @BelongsTo(() => AccountGroup, 'parentGroupId')
  parentGroup!: AccountGroup;

  @HasMany(() => AccountGroup, 'parentGroupId')
  childGroups!: AccountGroup[];

  @BelongsToMany(() => Accounts, () => AccountGrouping)
  accounts!: Accounts[];
}
