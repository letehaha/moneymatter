import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@models/transactions-query', () => ({ __esModule: true, updateTransactions: jest.fn() }));

/* eslint-disable import/first */
import { PROVIDER_TO_ACCOUNT_TYPE } from './restore-relinked-transactions-account-type';
/* eslint-enable import/first */

describe('PROVIDER_TO_ACCOUNT_TYPE', () => {
  it('maps every provider type to the account type of the same string value', () => {
    expect(PROVIDER_TO_ACCOUNT_TYPE).toEqual(
      Object.fromEntries(Object.values(BANK_PROVIDER_TYPE).map((providerType) => [providerType, providerType])),
    );
  });
});
