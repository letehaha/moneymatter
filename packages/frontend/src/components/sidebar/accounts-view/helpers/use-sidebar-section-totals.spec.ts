import { describe, expect, it } from 'vitest';

import { isSidebarBankAccount } from './use-sidebar-section-totals';

describe('isSidebarBankAccount', () => {
  it('keeps property accounts out of the bank accounts section', () => {
    const propertyAccount = {
      id: 'property-1',
      accountCategory: 'property',
    } as any;
    const bankAccount = {
      id: 'bank-1',
      accountCategory: 'cash',
    } as any;

    expect(isSidebarBankAccount({ account: propertyAccount, accountsInGroups: {} })).toBe(false);
    expect(isSidebarBankAccount({ account: bankAccount, accountsInGroups: {} })).toBe(true);
  });
});
