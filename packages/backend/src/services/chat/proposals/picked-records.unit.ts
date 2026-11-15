import { describe, expect, it } from '@jest/globals';

import { assertCardUsesPickedRecords } from './picked-records';
import { ToolInputError } from './placeholders';

const picked = [{ kind: 'account' as const, id: 'acc-wallet', label: 'Wallet (USD)' }];
const entityFields = {
  accountId: 'account' as const,
  counterAccountId: 'account' as const,
  categoryId: 'category' as const,
};

describe('assertCardUsesPickedRecords', () => {
  it('refuses a card on another account than the one the user tapped, and names the one they chose', () => {
    expect(() => assertCardUsesPickedRecords({ picked, entityFields, args: { accountId: 'acc-other' } })).toThrow(
      ToolInputError,
    );
    expect(() => assertCardUsesPickedRecords({ picked, entityFields, args: { accountId: 'acc-other' } })).toThrow(
      /Wallet \(USD\) \(account id acc-wallet\).*acc-other/,
    );
  });

  it('accepts a card that uses the tapped account, on either side of a pair of accounts', () => {
    expect(() =>
      assertCardUsesPickedRecords({ picked, entityFields, args: { accountId: 'acc-wallet' } }),
    ).not.toThrow();
    expect(() =>
      assertCardUsesPickedRecords({
        picked,
        entityFields,
        args: { accountId: 'acc-x', counterAccountId: 'acc-wallet' },
      }),
    ).not.toThrow();
  });

  it('leaves alone a card with no account, a placeholder for an account a parent card makes, and other kinds', () => {
    expect(() => assertCardUsesPickedRecords({ picked, entityFields, args: { categoryId: 'cat-1' } })).not.toThrow();
    expect(() =>
      assertCardUsesPickedRecords({
        picked,
        entityFields,
        args: { accountId: '$proposal:9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20' },
      }),
    ).not.toThrow();
  });

  it('checks nothing when the user picked no record', () => {
    expect(() =>
      assertCardUsesPickedRecords({ picked: [], entityFields, args: { accountId: 'acc-other' } }),
    ).not.toThrow();
  });
});
