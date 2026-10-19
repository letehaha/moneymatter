import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  AccountWithRelinkStatus,
  type RecordId,
} from '@bt/shared/types';

import { USER_CURRENCIES } from './currencies';
import { USER } from './user';

export const eurAccountName = 'Account EUR';
export const usdAccountName = 'Account USD';
export const uahAccountName = 'Account UAH';
export const uah2AccountName = 'Account UAH (2)';

export const ACCOUNTS: AccountWithRelinkStatus[] = [
  {
    id: '00000000-0000-0000-0000-000000000001' as RecordId,
    name: eurAccountName,
    initialBalance: 0,
    refInitialBalance: 0,
    currentBalance: 9,
    refCurrentBalance: 322.65,
    creditLimit: 0,
    refCreditLimit: 0,
    type: ACCOUNT_TYPES.system,
    accountCategory: ACCOUNT_CATEGORIES.general,
    currencyCode: USER_CURRENCIES.find((item) => item.currency?.code === 'EUR')!.currencyCode,
    userId: USER.id,
    externalId: undefined,
    status: ACCOUNT_STATUSES.active,
    excludeFromStats: false,
    logoDomain: null,
    logoInitials: null,
    logoColor: null,
    logoIcon: null,
    logoImageId: null,
    needsRelink: false,
  },
  {
    id: '00000000-0000-0000-0000-000000000002' as RecordId,
    name: usdAccountName,
    initialBalance: 0,
    refInitialBalance: 0,
    currentBalance: 20,
    refCurrentBalance: 745.99,
    creditLimit: 0,
    refCreditLimit: 0,
    type: ACCOUNT_TYPES.system,
    accountCategory: ACCOUNT_CATEGORIES.general,
    currencyCode: USER_CURRENCIES.find((item) => item.currency?.code === 'USD')!.currencyCode,
    userId: USER.id,
    externalId: undefined,
    status: ACCOUNT_STATUSES.active,
    excludeFromStats: false,
    logoDomain: null,
    logoInitials: null,
    logoColor: null,
    logoIcon: null,
    logoImageId: null,
    needsRelink: false,
  },
  {
    id: '00000000-0000-0000-0000-000000000003' as RecordId,
    name: uahAccountName,
    initialBalance: 0,
    refInitialBalance: 0,
    currentBalance: 0,
    refCurrentBalance: 0,
    creditLimit: 0,
    refCreditLimit: 0,
    type: ACCOUNT_TYPES.system,
    accountCategory: ACCOUNT_CATEGORIES.general,
    currencyCode: USER_CURRENCIES.find((item) => item.currency?.code === 'UAH')!.currencyCode,
    userId: USER.id,
    externalId: undefined,
    status: ACCOUNT_STATUSES.active,
    excludeFromStats: false,
    logoDomain: null,
    logoInitials: null,
    logoColor: null,
    logoIcon: null,
    logoImageId: null,
    needsRelink: false,
  },
  {
    id: '00000000-0000-0000-0000-000000000004' as RecordId,
    name: uah2AccountName,
    initialBalance: 0,
    refInitialBalance: 0,
    currentBalance: 0,
    refCurrentBalance: 0,
    creditLimit: 0,
    refCreditLimit: 0,
    type: ACCOUNT_TYPES.system,
    accountCategory: ACCOUNT_CATEGORIES.general,
    currencyCode: USER_CURRENCIES.find((item) => item.currency?.code === 'UAH')!.currencyCode,
    userId: USER.id,
    externalId: undefined,
    status: ACCOUNT_STATUSES.active,
    excludeFromStats: false,
    logoDomain: null,
    logoInitials: null,
    logoColor: null,
    logoIcon: null,
    logoImageId: null,
    needsRelink: false,
  },
];

export const getEurAccount = (overrides?: Partial<AccountWithRelinkStatus>) => ({
  ...ACCOUNTS.find((item) => item.name === eurAccountName),
  ...overrides,
});
export const getUsdAccount = (overrides?: Partial<AccountWithRelinkStatus>) => ({
  ...ACCOUNTS.find((item) => item.name === usdAccountName),
  ...overrides,
});
export const getUahAccount = (overrides?: Partial<AccountWithRelinkStatus>) => ({
  ...ACCOUNTS.find((item) => item.name === uahAccountName),
  ...overrides,
});
export const getUah2Account = (overrides?: Partial<AccountWithRelinkStatus>) => ({
  ...ACCOUNTS.find((item) => item.name === uah2AccountName),
  ...overrides,
});
