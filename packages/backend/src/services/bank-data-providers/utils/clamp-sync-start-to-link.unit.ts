import { type AccountExternalData, asDecimal } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import type Accounts from '@models/accounts.model';

import { clampSyncStartToLink } from './clamp-sync-start-to-link';

type AccountRow = InstanceType<typeof Accounts>;

const buildAccount = (externalData: AccountExternalData | null): AccountRow =>
  ({ externalData }) as unknown as AccountRow;

const buildLinkedAccount = (linkedAt: string): AccountRow =>
  buildAccount({
    bankConnection: {
      linkedAt,
      linkingStrategy: 'forward-only',
      balanceReconciliation: {
        systemBalance: asDecimal(0),
        externalBalance: asDecimal(0),
        difference: asDecimal(0),
        adjustmentTransactionId: null,
      },
    },
  });

const FROM = new Date('2024-06-01T00:00:00.000Z');

describe('clampSyncStartToLink', () => {
  it('passes `from` through when the account has no externalData', () => {
    expect(clampSyncStartToLink({ account: buildAccount(null), from: FROM })).toBe(FROM);
  });

  it('passes `from` through when externalData carries no bankConnection', () => {
    expect(clampSyncStartToLink({ account: buildAccount({ someOtherKey: 'value' }), from: FROM })).toBe(FROM);
  });

  it('passes `from` through when the bankConnection has no linkedAt', () => {
    const account = buildAccount({
      bankConnection: {
        linkingStrategy: 'forward-only',
        balanceReconciliation: {
          systemBalance: 0,
          externalBalance: 0,
          difference: 0,
          adjustmentTransactionId: null,
        },
      },
    } as unknown as AccountExternalData);

    expect(clampSyncStartToLink({ account, from: FROM })).toBe(FROM);
  });

  it('passes `from` through when linkedAt is an unparsable date string', () => {
    expect(clampSyncStartToLink({ account: buildLinkedAccount('not-a-date'), from: FROM })).toBe(FROM);
  });

  it('clamps forward to linkedAt when the link happened after the requested window start', () => {
    const result = clampSyncStartToLink({
      account: buildLinkedAccount('2024-07-15T09:30:00.000Z'),
      from: FROM,
    });

    expect(result.toISOString()).toBe('2024-07-15T09:30:00.000Z');
  });

  it('keeps `from` when the link predates the requested window start', () => {
    expect(clampSyncStartToLink({ account: buildLinkedAccount('2024-01-01T00:00:00.000Z'), from: FROM })).toBe(FROM);
  });

  it('keeps `from` when linkedAt equals the requested window start', () => {
    expect(clampSyncStartToLink({ account: buildLinkedAccount(FROM.toISOString()), from: FROM })).toBe(FROM);
  });
});
