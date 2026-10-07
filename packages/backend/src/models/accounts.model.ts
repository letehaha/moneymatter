import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountExternalData,
  type EntityLogoPayload,
  RecordId,
} from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import Balances from '@models/balances.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import Currencies from '@models/currencies.model';
import Transactions from '@models/transactions.model';
import Users from '@models/users.model';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, AfterCreate, HasMany } from 'sequelize-typescript';

interface AccountsAttributes {
  id: string;
  name: string;
  initialBalance: Money;
  refInitialBalance: Money;
  currentBalance: Money;
  refCurrentBalance: Money;
  creditLimit: Money;
  refCreditLimit: Money;
  type: ACCOUNT_TYPES;
  accountCategory: ACCOUNT_CATEGORIES;
  currencyCode: string;
  userId: number;
  externalId: string; // represents id from the original external system if exists
  externalData: AccountExternalData | null; // JSON of any addition fields
  // cashbackType: string; // move to additionalFields that will represent non-unified data
  // maskedPan: string; // move to additionalFields
  // type: string; // move to additionalFields
  // iban: string; // move to additionalFields
  status: ACCOUNT_STATUSES;
  excludeFromStats: boolean;
  bankDataProviderConnectionId?: string; // FK to BankDataProviderConnections
  logoDomain: string | null;
  logoInitials: string | null;
  logoColor: string | null;
}

@Table({
  timestamps: false,
  tableName: 'Accounts',
  freezeTableName: true,
})
export default class Accounts extends Model {
  @BelongsTo(() => Currencies, {
    as: 'currency',
    foreignKey: 'currencyCode',
  })
  @BelongsTo(() => BankDataProviderConnections, {
    as: 'bankDataProviderConnection',
    foreignKey: 'bankDataProviderConnectionId',
  })
  @HasMany(() => Transactions)
  transactions!: Transactions[];

  @Column(IdColumn())
  declare id: RecordId;

  @Column({ allowNull: false, type: DataType.STRING })
  name!: string;

  @MoneyField({ storage: 'cents' })
  declare initialBalance: Money;

  @MoneyField({ storage: 'cents' })
  declare refInitialBalance: Money;

  @MoneyField({ storage: 'cents' })
  declare currentBalance: Money;

  @MoneyField({ storage: 'cents' })
  declare refCurrentBalance: Money;

  @MoneyField({ storage: 'cents' })
  declare creditLimit: Money;

  @MoneyField({ storage: 'cents' })
  declare refCreditLimit: Money;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: ACCOUNT_TYPES.system,
  })
  type!: ACCOUNT_TYPES;

  @Column({
    allowNull: false,
    defaultValue: ACCOUNT_CATEGORIES.general,
    type: DataType.STRING(50),
    validate: { isIn: [Object.values(ACCOUNT_CATEGORIES)] },
  })
  accountCategory!: ACCOUNT_CATEGORIES;

  @ForeignKey(() => Currencies)
  @Column({ type: DataType.STRING(3) })
  currencyCode!: string;

  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER })
  userId!: number;

  // represents id from the original external system if exists
  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  externalId!: string;

  @Column({
    type: DataType.JSONB,
    allowNull: true,
  })
  externalData!: AccountExternalData | null; // JSON of any addition fields
  // cashbackType: string;
  // maskedPan: string;
  // type: string;
  // iban: string;

  @Column({
    type: DataType.ENUM({ values: Object.values(ACCOUNT_STATUSES) }),
    allowNull: false,
    defaultValue: ACCOUNT_STATUSES.active,
  })
  status!: ACCOUNT_STATUSES;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  excludeFromStats!: boolean;

  @ForeignKey(() => BankDataProviderConnections)
  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  bankDataProviderConnectionId!: RecordId;

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

  @AfterCreate
  static async updateAccountBalanceAfterCreate(instance: Accounts) {
    await Balances.handleAccountChange({ account: instance });
  }
}

export interface GetAccountsPayload {
  userId: AccountsAttributes['userId'];
  type?: AccountsAttributes['type'];
}

export const getAccounts = async (payload: GetAccountsPayload) => {
  const { userId, type } = payload;
  const where: {
    userId: AccountsAttributes['userId'];
    type?: AccountsAttributes['type'];
  } = { userId };

  if (type) where.type = type;

  const accounts = await Accounts.findAll({
    where,
  });

  return accounts;
};

export const getAccountById = async ({
  userId,
  id,
  raw,
}: {
  userId: AccountsAttributes['userId'];
  id: AccountsAttributes['id'];
  raw?: boolean;
}) => {
  const account = await Accounts.findOne({
    where: { userId, id },
    raw,
  });

  return account;
};

export interface CreateAccountPayload extends EntityLogoPayload {
  externalId?: AccountsAttributes['externalId'];
  externalData?: AccountsAttributes['externalData'];
  status?: AccountsAttributes['status'];
  excludeFromStats?: AccountsAttributes['excludeFromStats'];
  accountCategory: AccountsAttributes['accountCategory'];
  currencyCode: AccountsAttributes['currencyCode'];
  name: AccountsAttributes['name'];
  initialBalance: AccountsAttributes['initialBalance'];
  refInitialBalance: AccountsAttributes['refInitialBalance'];
  creditLimit: AccountsAttributes['creditLimit'];
  refCreditLimit: AccountsAttributes['refCreditLimit'];
  userId: AccountsAttributes['userId'];
  type: AccountsAttributes['type'];
}

export const createAccount = async ({
  userId,
  type = ACCOUNT_TYPES.system,
  status = ACCOUNT_STATUSES.active,
  excludeFromStats = false,
  ...rest
}: CreateAccountPayload) => {
  const response = await Accounts.create({
    userId,
    type,
    status,
    excludeFromStats,
    currentBalance: rest.initialBalance,
    refCurrentBalance: rest.refInitialBalance,
    ...rest,
  });

  const account = await getAccountById({
    id: response.get('id'),
    userId,
  });

  return account;
};

export interface UpdateAccountByIdPayload extends EntityLogoPayload {
  id: AccountsAttributes['id'];
  userId: AccountsAttributes['userId'];
  externalId?: AccountsAttributes['externalId'];
  accountCategory?: AccountsAttributes['accountCategory'];
  // currency updating is disabled
  // currencyCode?: AccountsAttributes['currencyCode'];
  name?: AccountsAttributes['name'];
  initialBalance?: AccountsAttributes['initialBalance'];
  refInitialBalance?: AccountsAttributes['refInitialBalance'];
  currentBalance?: AccountsAttributes['currentBalance'];
  refCurrentBalance?: AccountsAttributes['refCurrentBalance'];
  creditLimit?: AccountsAttributes['creditLimit'];
  refCreditLimit?: AccountsAttributes['refCreditLimit'];
  status?: AccountsAttributes['status'];
  excludeFromStats?: AccountsAttributes['excludeFromStats'];
  externalData?: AccountsAttributes['externalData'];
}

export async function updateAccountById({ id, userId, ...payload }: UpdateAccountByIdPayload) {
  const where = { id, userId };

  await Accounts.update(payload, { where });

  const account = await getAccountById(where);

  return account;
}

export const deleteAccountById = ({ id, userId }: { id: string; userId: number }) => {
  return Accounts.destroy({ where: { id, userId } });
};

/** Reads the account's current `type`: a transaction's `accountType` is a snapshot of it. */
export const isBankLinkedAccount = async ({ id }: { id: string }) => {
  const account = await Accounts.findByPk(id, { attributes: ['type'] });

  return Boolean(account) && account!.type !== ACCOUNT_TYPES.system;
};

export const getAccountCurrency = async ({ userId, id }: { userId: number; id: string }) => {
  const account = (await Accounts.findOne({
    where: { userId, id },
    include: {
      model: Currencies,
    },
  })) as Accounts & { currency: Currencies };

  return account;
};

export const getAccountsByCurrency = ({ userId, currencyCode }: { userId: number; currencyCode: string }) => {
  return Accounts.findAll({ where: { userId, currencyCode } });
};
