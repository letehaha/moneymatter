import type { AccountGroups } from '@/common/types/models';
import { computeAccountDisplayBalances } from '@/common/utils/account-balance';
import type { AccountModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  type AccountsListItem,
  accountBaseValue,
  defaultSortDirection,
  groupBaseValue,
  sortItems,
  sortMixed,
} from './accounts-sort';

const makeAccount = ({
  id,
  name,
  refCurrentBalance = 0,
  currentBalance = refCurrentBalance,
  creditLimit = 0,
  refCreditLimit = creditLimit,
  currencyCode = 'USD',
}: {
  id: string;
  name: string;
  refCurrentBalance?: number;
  currentBalance?: number;
  creditLimit?: number;
  refCreditLimit?: number;
  currencyCode?: string;
}): AccountModel =>
  ({
    id,
    name,
    currentBalance,
    refCurrentBalance,
    creditLimit,
    refCreditLimit,
    currencyCode,
  }) as unknown as AccountModel;

const makeGroup = ({
  id,
  name,
  accounts = [],
  childGroups = [],
}: {
  id: string;
  name: string;
  accounts?: AccountModel[];
  childGroups?: AccountGroups[];
}): AccountGroups => ({ id, name, accounts, childGroups }) as unknown as AccountGroups;

/** Collapse a tagged list into the plain names in order, for concise assertions. */
const names = (items: AccountsListItem[]): string[] =>
  items.map((item) => (item.kind === 'group' ? item.group.name : item.account.name));

describe('accountBaseValue', () => {
  it('returns the base-currency balance unchanged for a plain account', () => {
    const account = makeAccount({ id: 'a', name: 'Plain', currentBalance: 1200, refCurrentBalance: 1200 });
    expect(accountBaseValue({ account, includeCreditLimit: false })).toBe(1200);
  });

  it('nets the credit limit off the base balance when includeCreditLimit is on', () => {
    const account = makeAccount({
      id: 'c',
      name: 'Card',
      currentBalance: 1000,
      refCurrentBalance: 1000,
      creditLimit: 400,
    });

    // Off: the raw base balance shows.
    expect(accountBaseValue({ account, includeCreditLimit: false })).toBe(1000);

    // On: same figure the shared display util yields (balance net of the limit).
    const expected = computeAccountDisplayBalances({
      currentBalance: 1000,
      refCurrentBalance: 1000,
      creditLimit: 400,
      refCreditLimit: 400,
      includeCreditLimit: true,
    }).displayRefBalance;
    expect(expected).toBe(600);
    expect(accountBaseValue({ account, includeCreditLimit: true })).toBe(expected);
  });
});

describe('groupBaseValue', () => {
  it('rolls up direct accounts plus nested child-group accounts', () => {
    const group = makeGroup({
      id: 'g',
      name: 'Parent',
      accounts: [makeAccount({ id: 'direct', name: 'Direct', refCurrentBalance: 200 })],
      childGroups: [
        makeGroup({
          id: 'child',
          name: 'Child',
          accounts: [makeAccount({ id: 'nested', name: 'Nested', refCurrentBalance: 300 })],
        }),
      ],
    });

    expect(groupBaseValue({ group, baseCurrencyCode: 'USD', includeCreditLimit: false })).toBe(500);
  });
});

describe('sortItems', () => {
  const items = [
    { name: 'Banana', value: 10 },
    { name: 'apple', value: 30 },
    { name: 'Cherry 10', value: 20 },
    { name: 'Cherry 2', value: 20 },
  ];
  const getName = (item: { name: string }) => item.name;
  const getValue = (item: { value: number }) => item.value;

  it('sorts ascending by name (case-insensitive, natural order) for the auto key', () => {
    const result = sortItems({ items, sortKey: 'auto', getName, getValue });
    expect(result.map(getName)).toEqual(['apple', 'Banana', 'Cherry 2', 'Cherry 10']);
  });

  it('sorts ascending by name for the name key', () => {
    const result = sortItems({ items, sortKey: 'name', getName, getValue });
    expect(result.map(getName)).toEqual(['apple', 'Banana', 'Cherry 2', 'Cherry 10']);
  });

  it('sorts descending by value for the balance key', () => {
    const result = sortItems({ items, sortKey: 'balance', getName, getValue });
    expect(result.map(getValue)).toEqual([30, 20, 20, 10]);
  });

  it('tie-breaks equal balances ascending by name', () => {
    const result = sortItems({ items, sortKey: 'balance', getName, getValue });
    // The two value:20 entries (Cherry 2 / Cherry 10) resolve in natural name order.
    expect(result.map(getName)).toEqual(['apple', 'Cherry 2', 'Cherry 10', 'Banana']);
  });

  it('does not mutate the input array', () => {
    const original = [...items];
    sortItems({ items, sortKey: 'balance', getName, getValue });
    expect(items).toEqual(original);
  });

  it('sorts descending by name when direction is desc', () => {
    const result = sortItems({ items, sortKey: 'name', direction: 'desc', getName, getValue });
    expect(result.map(getName)).toEqual(['Cherry 10', 'Cherry 2', 'Banana', 'apple']);
  });

  it('sorts ascending by value when direction is asc, keeping A→Z tie-breaks', () => {
    const result = sortItems({ items, sortKey: 'balance', direction: 'asc', getName, getValue });
    expect(result.map(getName)).toEqual(['Banana', 'Cherry 2', 'Cherry 10', 'apple']);
  });

  it('puts the largest credit-card debt first when balances sort ascending', () => {
    const cards = [
      { name: 'Unused card', value: 0 },
      { name: 'Small debt', value: -990.15 },
      { name: 'Large debt', value: -258253.58 },
    ];
    const result = sortItems({ items: cards, sortKey: 'balance', direction: 'asc', getName, getValue });
    expect(result.map(getName)).toEqual(['Large debt', 'Small debt', 'Unused card']);
  });
});

describe('defaultSortDirection', () => {
  it('starts balance descending and name-based keys ascending', () => {
    expect(defaultSortDirection({ sortKey: 'balance' })).toBe('desc');
    expect(defaultSortDirection({ sortKey: 'name' })).toBe('asc');
    expect(defaultSortDirection({ sortKey: 'auto' })).toBe('asc');
  });
});

describe('sortMixed', () => {
  const groups = [
    makeGroup({
      id: 'g1',
      name: 'Zebra',
      accounts: [makeAccount({ id: 'ga1', name: 'z-acc', refCurrentBalance: 500 })],
    }),
    makeGroup({
      id: 'g2',
      name: 'Mango',
      accounts: [makeAccount({ id: 'ga2', name: 'm-acc', refCurrentBalance: 100 })],
    }),
  ];
  const accounts = [
    makeAccount({ id: 'a1', name: 'Yak', refCurrentBalance: 900 }),
    makeAccount({ id: 'a2', name: 'Bee', refCurrentBalance: 300 }),
  ];

  it('auto puts the groups block first (name-sorted) then the accounts block (name-sorted)', () => {
    const result = sortMixed({ groups, accounts, sortKey: 'auto', baseCurrencyCode: 'USD', includeCreditLimit: false });
    // Groups first regardless of the far larger account balances, each block alphabetised.
    expect(result.map((item) => item.kind)).toEqual(['group', 'group', 'account', 'account']);
    expect(names(result)).toEqual(['Mango', 'Zebra', 'Bee', 'Yak']);
  });

  it('name interleaves groups and accounts alphabetically', () => {
    const result = sortMixed({ groups, accounts, sortKey: 'name', baseCurrencyCode: 'USD', includeCreditLimit: false });
    expect(names(result)).toEqual(['Bee', 'Mango', 'Yak', 'Zebra']);
    expect(result.map((item) => item.kind)).toEqual(['account', 'group', 'account', 'group']);
  });

  it('forwards direction: auto desc reverses each block, groups still lead; balance asc interleaves', () => {
    const common = { groups, accounts, baseCurrencyCode: 'USD', includeCreditLimit: false };
    expect(names(sortMixed({ ...common, sortKey: 'auto', direction: 'desc' }))).toEqual([
      'Zebra',
      'Mango',
      'Yak',
      'Bee',
    ]);
    expect(names(sortMixed({ ...common, sortKey: 'balance', direction: 'asc' }))).toEqual([
      'Mango',
      'Bee',
      'Zebra',
      'Yak',
    ]);
  });

  it('balance interleaves groups and accounts descending by base value', () => {
    const result = sortMixed({
      groups,
      accounts,
      sortKey: 'balance',
      baseCurrencyCode: 'USD',
      includeCreditLimit: false,
    });
    // Yak 900, Zebra group 500, Bee 300, Mango group 100.
    expect(names(result)).toEqual(['Yak', 'Zebra', 'Bee', 'Mango']);
    expect(result.map((item) => item.kind)).toEqual(['account', 'group', 'account', 'group']);
  });
});
