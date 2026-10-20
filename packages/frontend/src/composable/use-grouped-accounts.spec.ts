import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountModel,
  type RecordId,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { filterSelectableAccounts, sortAccounts } from './use-grouped-accounts';

const makeAccount = (overrides: Partial<AccountModel> = {}): AccountModel => ({
  type: ACCOUNT_TYPES.system,
  id: '00000000-0000-0000-0000-000000000001' as RecordId,
  name: 'Cash',
  initialBalance: 0,
  refInitialBalance: 0,
  currentBalance: 0,
  refCurrentBalance: 0,
  creditLimit: 0,
  refCreditLimit: 0,
  accountCategory: ACCOUNT_CATEGORIES.general,
  currencyCode: 'USD',
  userId: 1,
  status: ACCOUNT_STATUSES.active,
  excludeFromStats: false,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  ...overrides,
});

describe('sortAccounts', () => {
  it('puts balance-holding accounts first, then falls back to alphabetical within each group', () => {
    const accounts = [
      makeAccount({ id: '1' as RecordId, name: 'Alpha', currentBalance: 0 }),
      makeAccount({ id: '2' as RecordId, name: 'Zebra', currentBalance: 100 }),
      makeAccount({ id: '3' as RecordId, name: 'Beta', currentBalance: 0 }),
      makeAccount({ id: '4' as RecordId, name: 'Mango', currentBalance: 50 }),
    ];

    expect(sortAccounts({ accounts }).map((account) => account.name)).toEqual(['Mango', 'Zebra', 'Alpha', 'Beta']);
  });

  it('does not mutate the input array', () => {
    const accounts = [
      makeAccount({ id: '1' as RecordId, name: 'B', currentBalance: 0 }),
      makeAccount({ id: '2' as RecordId, name: 'A', currentBalance: 100 }),
    ];
    const original = [...accounts];
    sortAccounts({ accounts });
    expect(accounts).toEqual(original);
  });
});

describe('filterSelectableAccounts', () => {
  const active = makeAccount({ id: 'active' as RecordId, name: 'Active', status: ACCOUNT_STATUSES.active });
  const archived = makeAccount({ id: 'archived' as RecordId, name: 'Archived', status: ACCOUNT_STATUSES.archived });
  const loan = makeAccount({ id: 'loan' as RecordId, name: 'Loan', accountCategory: ACCOUNT_CATEGORIES.loan });
  const vehicle = makeAccount({
    id: 'vehicle' as RecordId,
    name: 'Vehicle',
    accountCategory: ACCOUNT_CATEGORIES.vehicle,
  });

  it('drops archived accounts by default', () => {
    expect(filterSelectableAccounts({ accounts: [active, archived] }).map((a) => a.id)).toEqual(['active']);
  });

  it('keeps archived accounts when includeArchived is set', () => {
    expect(filterSelectableAccounts({ accounts: [active, archived], includeArchived: true }).map((a) => a.id)).toEqual([
      'active',
      'archived',
    ]);
  });

  it('keeps loan and vehicle accounts by default', () => {
    expect(filterSelectableAccounts({ accounts: [active, loan, vehicle] }).map((a) => a.id)).toEqual([
      'active',
      'loan',
      'vehicle',
    ]);
  });

  it('drops loan and vehicle (dedicated-flow) accounts when excludeDedicatedFlow is set', () => {
    expect(
      filterSelectableAccounts({ accounts: [active, loan, vehicle], excludeDedicatedFlow: true }).map((a) => a.id),
    ).toEqual(['active']);
  });

  it('composes the archived and dedicated-flow filters', () => {
    const archivedLoan = makeAccount({
      id: 'archived-loan' as RecordId,
      status: ACCOUNT_STATUSES.archived,
      accountCategory: ACCOUNT_CATEGORIES.loan,
    });
    expect(
      filterSelectableAccounts({
        accounts: [active, archived, loan, vehicle, archivedLoan],
        excludeDedicatedFlow: true,
      }).map((a) => a.id),
    ).toEqual(['active']);
  });
});
