import { API_ERROR_CODES, RESOURCE_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import ResourceShares from '@models/resource-shares.model';
import * as helpers from '@tests/helpers';
import { ErrorResponse } from '@tests/helpers/common';

// Share-blocker rejections still surface synchronously at enqueue, so these tests
// read the immediate response. The "allows" cases enqueue a real job and poll it
// to completion via changeBaseCurrencyAndWait instead.
const callChangeBase = () => helpers.changeBaseCurrency({ newCurrencyCode: 'USD' });

/**
 * Verifies the active-share guard on `POST /user/currencies/change-base`. Both ends of
 * an accepted share must agree on a base currency; letting either side flip currency
 * after acceptance would silently desync `refAmount` math across users. Pending
 * invitations don't lock — they're handled by the accept-time currency check.
 */
describe('Change Base Currency — active share guard', () => {
  beforeEach(async () => {
    // Both users default to `global.BASE_CURRENCY.code` (set by the integration-test
    // bootstrap), so we don't switch the owner's base in the suite — `provisionSecondUser`
    // will line the recipient up on the same currency, which is what the accept guard
    // needs. We just add a target currency the change-base call can switch *into*.
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
  });

  it('rejects the change for both sides of an accepted per-resource share', async () => {
    const account = await helpers.createAccount({ raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();

    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      permission: SHARE_PERMISSIONS.read,
      raw: true,
    });

    const acceptRes = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: invitation.token }),
    });
    expect(acceptRes.statusCode).toBe(200);

    const ownerRes = await callChangeBase();
    expect(ownerRes.statusCode).toBe(409);
    expect((ownerRes.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.baseCurrencyLockedByShares);

    const recipientRes = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        // Mirror the owner's currency setup so the only thing standing between the
        // recipient and a successful change-base is the share guard itself.
        await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
        return callChangeBase();
      },
    });

    expect(recipientRes.statusCode).toBe(409);
    expect((recipientRes.body.response as unknown as ErrorResponse).code).toBe(
      API_ERROR_CODES.baseCurrencyLockedByShares,
    );
  });

  it('rejects the change for both sides of an accepted tracker share', async () => {
    const tracker = await helpers.createTracker({ name: 'Shared tracker', raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();

    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.tracker,
      resourceId: tracker.id,
      permission: SHARE_PERMISSIONS.read,
      raw: true,
    });
    await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
    });

    const ownerRes = await callChangeBase();
    expect((ownerRes.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.baseCurrencyLockedByShares);

    const recipientRes = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
        return callChangeBase();
      },
    });
    expect((recipientRes.body.response as unknown as ErrorResponse).code).toBe(
      API_ERROR_CODES.baseCurrencyLockedByShares,
    );
  });

  it('allows the change when only a pending (not-yet-accepted) invitation exists', async () => {
    const account = await helpers.createAccount({ raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();

    await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      permission: SHARE_PERMISSIONS.read,
      raw: true,
    });

    const status = await helpers.changeBaseCurrencyAndWait({
      newCurrencyCode: 'USD',
    });
    helpers.expectBaseCurrencyChangeCompleted(status);
  });

  it('rejects with BASE_CURRENCY_LOCKED_BY_HOUSEHOLD for both sides, and lists every blocker type', async () => {
    // Household rows are user-scoped: one membership blocks the change whatever the
    // account count. The per-resource share is created last so the household-only
    // assertions above it still hold.
    const account = await helpers.createAccount({ raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const recipientApp = await helpers.findAppUserByEmail({
      email: recipient.email,
    });

    await ResourceShares.create({
      ownerUserId: account.userId,
      sharedWithUserId: recipientApp.id,
      resourceType: RESOURCE_TYPES.household,
      resourceId: String(account.userId),
      permission: SHARE_PERMISSIONS.write,
      acceptedAt: new Date(),
    });

    type BlockerError = ErrorResponse & {
      details?: { blockers?: Array<{ type: string; count: number }> };
    };

    const ownerRes = await callChangeBase();
    expect(ownerRes.statusCode).toBe(409);
    const ownerErr = ownerRes.body.response as unknown as BlockerError;
    expect(ownerErr.code).toBe(API_ERROR_CODES.baseCurrencyLockedByHousehold);
    expect(ownerErr.details?.blockers).toEqual(expect.arrayContaining([{ type: 'household', count: 1 }]));

    const recipientRes = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        // Recipient also needs USD available before they can try to change base into it.
        await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
        return callChangeBase();
      },
    });

    expect(recipientRes.statusCode).toBe(409);
    const recipientErr = recipientRes.body.response as unknown as BlockerError;
    expect(recipientErr.code).toBe(API_ERROR_CODES.baseCurrencyLockedByHousehold);
    expect(recipientErr.details?.blockers).toEqual(expect.arrayContaining([{ type: 'household', count: 1 }]));

    // Accepted per-resource share to a different user — same owner can still have both
    // a household member and a per-account share (different recipients). Provision a
    // third user to receive the per-resource share so the per-resource count is 1.
    const otherRecipient = await helpers.provisionSecondUserWithBaseCurrency({
      email: `other-${Date.now()}@test.local`,
    });
    const otherRecipientApp = await helpers.findAppUserByEmail({
      email: otherRecipient.email,
    });
    await ResourceShares.create({
      ownerUserId: account.userId,
      sharedWithUserId: otherRecipientApp.id,
      resourceType: RESOURCE_TYPES.account,
      resourceId: String(account.id),
      permission: SHARE_PERMISSIONS.read,
      acceptedAt: new Date(),
    });

    const bothRes = await callChangeBase();
    expect(bothRes.statusCode).toBe(409);
    const bothErr = bothRes.body.response as unknown as BlockerError;
    // Household takes the primary code when both are present.
    expect(bothErr.code).toBe(API_ERROR_CODES.baseCurrencyLockedByHousehold);
    expect(bothErr.details?.blockers).toEqual(
      expect.arrayContaining([
        { type: 'household', count: 1 },
        { type: 'share', count: 1 },
      ]),
    );
  });
});
