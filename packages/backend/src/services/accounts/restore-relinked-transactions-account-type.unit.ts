import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { PROVIDER_TO_ACCOUNT_TYPE } from '@services/bank-data-providers/types';

describe('PROVIDER_TO_ACCOUNT_TYPE', () => {
  it('maps every provider type to the account type of the same string value', () => {
    expect(PROVIDER_TO_ACCOUNT_TYPE).toEqual(
      Object.fromEntries(Object.values(BANK_PROVIDER_TYPE).map((providerType) => [providerType, providerType])),
    );
  });
});
