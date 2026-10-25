import { AutoRenewStatus, Status } from '@apple/app-store-server-library';
import { APPLE_PRODUCT_IDS, BILLING_PROVIDERS, SUBSCRIPTION_STATUSES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import type { AppleSubscriptionState } from './client';
import { toAppleSubscriptionEvent } from './to-subscription-event';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25);

const buildState = (overrides: Partial<AppleSubscriptionState> = {}): AppleSubscriptionState => ({
  status: Status.ACTIVE,
  transaction: {
    originalTransactionId: '2000000000000001',
    productId: APPLE_PRODUCT_IDS.essential.year,
    expiresDate: NOW + 30 * DAY,
    signedDate: NOW,
  },
  renewalInfo: { autoRenewStatus: AutoRenewStatus.ON },
  ...overrides,
});

const map = (state: AppleSubscriptionState) =>
  toAppleSubscriptionEvent({ state, eventId: null, userId: 1, externalCustomerId: 'token' });

describe('toAppleSubscriptionEvent', () => {
  it('maps an active subscription', () => {
    expect(map(buildState())).toMatchObject({
      provider: BILLING_PROVIDERS.apple,
      externalSubscriptionId: '2000000000000001',
      status: SUBSCRIPTION_STATUSES.active,
      tier: 'essential',
      billingCycle: 'year',
      currentPeriodEndsAt: new Date(NOW + 30 * DAY),
      scheduledChange: null,
      providerUpdatedAt: new Date(NOW),
    });
  });

  it.each([
    [Status.BILLING_RETRY, SUBSCRIPTION_STATUSES.past_due],
    [Status.BILLING_GRACE_PERIOD, SUBSCRIPTION_STATUSES.past_due],
    [Status.EXPIRED, SUBSCRIPTION_STATUSES.canceled],
    [Status.REVOKED, SUBSCRIPTION_STATUSES.canceled],
  ])('maps App Store status %s to %s', (status, expected) => {
    expect(map(buildState({ status })).status).toBe(expected);
  });

  it('extends access to the grace period end only while in grace', () => {
    const renewalInfo = { autoRenewStatus: AutoRenewStatus.ON, gracePeriodExpiresDate: NOW + 5 * DAY };
    const transaction = { ...buildState().transaction, expiresDate: NOW - DAY };

    expect(
      map(buildState({ status: Status.BILLING_GRACE_PERIOD, transaction, renewalInfo })).currentPeriodEndsAt,
    ).toEqual(new Date(NOW + 5 * DAY));
    expect(map(buildState({ status: Status.BILLING_RETRY, transaction, renewalInfo })).currentPeriodEndsAt).toEqual(
      new Date(NOW - DAY),
    );
  });

  it('schedules a cancel at expiry when auto-renew is off', () => {
    expect(map(buildState({ renewalInfo: { autoRenewStatus: AutoRenewStatus.OFF } })).scheduledChange).toEqual({
      action: 'cancel',
      effectiveAt: new Date(NOW + 30 * DAY).toISOString(),
    });
  });

  it('cancels a revoked transaction at its revocation date, whatever the status says', () => {
    const transaction = { ...buildState().transaction, revocationDate: NOW - DAY };
    const event = map(buildState({ transaction, renewalInfo: { autoRenewStatus: AutoRenewStatus.OFF } }));

    expect(event.status).toBe(SUBSCRIPTION_STATUSES.canceled);
    expect(event.currentPeriodEndsAt).toEqual(new Date(NOW - DAY));
    expect(event.scheduledChange).toBeNull();
  });

  it('rejects a product that is not ours and an unknown status', () => {
    expect(() => map(buildState({ transaction: { ...buildState().transaction, productId: 'other' } }))).toThrow(
      /Unknown App Store product id/,
    );
    expect(() => map(buildState({ status: 9 as Status }))).toThrow(/Unknown App Store subscription status/);
  });
});
