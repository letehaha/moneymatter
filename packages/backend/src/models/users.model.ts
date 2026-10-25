import type { RecordId } from '@bt/shared/types';
import { Plan, UserModel, USER_ROLES, UserRole } from '@bt/shared/types';
import { Table, Column, Model, BelongsToMany, Length, DataType } from 'sequelize-typescript';

import Currencies from './currencies.model';
import UsersCurrencies from './users-currencies.model';

const DETAULT_TOTAL_BALANCE = 0;

@Table({
  timestamps: false,
  tableName: 'Users',
  freezeTableName: true,
})
export default class Users extends Model {
  @BelongsToMany(() => Currencies, {
    as: 'currencies',
    through: () => UsersCurrencies,
  })
  @Column({
    primaryKey: true,
    autoIncrement: true,
    allowNull: false,
    unique: true,
    type: DataType.INTEGER,
  })
  declare id: number;

  @Column({
    unique: true,
    allowNull: false,
    type: DataType.STRING,
  })
  username!: string;

  @Column({ allowNull: true, type: DataType.STRING })
  firstName!: string;

  @Column({ allowNull: true, type: DataType.STRING })
  lastName!: string;

  @Column({ allowNull: true, type: DataType.STRING })
  middleName!: string;

  @Column({ allowNull: true, type: DataType.STRING })
  authUserId!: RecordId;

  @Length({ max: 2000 })
  @Column({ allowNull: true, type: DataType.STRING })
  avatar!: string;

  @Column({
    defaultValue: DETAULT_TOTAL_BALANCE,
    allowNull: false,
    type: DataType.NUMBER,
  })
  totalBalance!: number;

  @Column({ allowNull: true, type: DataType.UUID })
  defaultCategoryId!: RecordId;

  @Column({
    allowNull: false,
    type: DataType.STRING(20),
    defaultValue: USER_ROLES.common,
  })
  role!: UserRole;

  @Column({
    allowNull: false,
    type: DataType.DATE,
    defaultValue: DataType.NOW,
  })
  declare createdAt: Date;

  /** Lifetime plan grant. Subscriptions live in BillingSubscriptions. */
  @Column({ allowNull: true, type: DataType.STRING(20) })
  plan!: Plan | null;

  /** Cloud only. Null means the user predates trials and resolves as Plus until the grandfather script runs. */
  @Column({ allowNull: true, type: DataType.DATE })
  trialEndsAt!: Date | null;

  @Column({ allowNull: false, unique: true, type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  appStoreAccountToken!: string;

  /** Early adopter budget trial anchor. Written once, never reset. */
  @Column({ allowNull: true, type: DataType.DATE })
  firstBudgetPlanAt!: Date | null;
}

export const getUserDefaultCategory = async ({ id }: { id: number }) => {
  const user = await Users.findOne({
    where: { id },
    attributes: ['defaultCategoryId'],
  });

  return user!.defaultCategoryId;
};

export const createUser = async ({
  username,
  firstName,
  lastName,
  middleName,
  avatar,
  totalBalance = DETAULT_TOTAL_BALANCE,
  authUserId,
  role = USER_ROLES.common,
  trialEndsAt = null,
}: {
  username: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  avatar?: string;
  totalBalance?: number;
  authUserId?: string;
  role?: UserRole;
  trialEndsAt?: Date | null;
}): Promise<UserModel> => {
  const user = await Users.create({
    username,
    firstName,
    lastName,
    middleName,
    avatar,
    totalBalance,
    authUserId,
    role,
    trialEndsAt,
  });

  return user;
};

export const getUserByAuthUserId = async ({
  authUserId,
}: {
  authUserId: string;
}): Promise<Pick<UserModel, 'id' | 'username' | 'role'> | null> => {
  const user = await Users.findOne({
    where: { authUserId },
    attributes: ['id', 'username', 'role'],
    raw: true,
  });

  return user;
};

export const updateUserById = async ({
  id,
  username,
  firstName,
  lastName,
  middleName,
  avatar,
  totalBalance,
  defaultCategoryId,
}: {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  avatar?: string;
  totalBalance?: number;
  defaultCategoryId?: RecordId;
}): Promise<UserModel | null> => {
  const where = { id };
  const updateFields: Record<string, unknown> = {};

  if (username) updateFields.username = username;
  if (firstName) updateFields.firstName = firstName;
  if (lastName) updateFields.lastName = lastName;
  if (middleName) updateFields.middleName = middleName;
  if (avatar) updateFields.avatar = avatar;
  if (totalBalance) updateFields.totalBalance = totalBalance;
  if (defaultCategoryId) updateFields.defaultCategoryId = defaultCategoryId;

  await Users.update(updateFields, {
    where,
  });

  const user = await Users.findOne({
    where,
  });

  return user;
};
