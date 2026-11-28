import { API_ERROR_CODES, NOTIFICATION_TYPES, RESOURCE_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const DAY = 24 * 60 * 60 * 1000;

const becomeReadOnly = () => helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

describe('Read-only allowlist (enforceReadOnly)', () => {
  it('lets a read-only user change their settings', async () => {
    await becomeReadOnly();

    const put = await helpers.updateUserSettings({ settings: { locale: 'uk' } });
    expect(put.statusCode).toBe(200);

    const patch = await helpers.patchUserSettings({ patch: { locale: 'en' } });
    expect(patch.statusCode).toBe(200);
  });

  it('lets a read-only user clear their notifications', async () => {
    await becomeReadOnly();

    const readAll = await helpers.markAllAsRead({ raw: false });
    expect(readAll.statusCode).toBe(200);

    const readOne = await helpers.makeRequest({ method: 'post', url: `/notifications/${NONEXISTENT_ID}/read` });
    expect(readOne.statusCode).not.toBe(402);
  });

  it('lets a read-only user dismiss a notification', async () => {
    const created = await helpers.makeRequest<{ id: string }, true>({
      method: 'post',
      url: '/notifications',
      payload: { type: NOTIFICATION_TYPES.trackerAlert, title: 'To be dismissed' },
      raw: true,
    });
    await becomeReadOnly();

    const dismiss = await helpers.dismissNotification({ id: created.id, raw: true });
    expect(dismiss.success).toBe(true);
    expect(await helpers.getNotifications({ raw: true })).toHaveLength(0);
  });

  it('blocks a read-only invitee from accepting an invitation', async () => {
    const account = await helpers.createAccount({ raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      permission: SHARE_PERMISSIONS.read,
      raw: true,
    });

    const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });
    await helpers.setUserBilling({ authUserId: recipientApp.authUserId, trialEndsAt: new Date(Date.now() - DAY) });

    const accept = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: false }),
    });

    expect(accept.statusCode).toBe(402);
    expect((accept.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);
  });

  it('still blocks writes outside the allowlist', async () => {
    await becomeReadOnly();

    const write = await helpers.makeRequest({
      method: 'post',
      url: '/accounts',
      payload: helpers.buildAccountPayload(),
    });
    expect(write.statusCode).toBe(402);
    expect(write.body.response.code).toBe(API_ERROR_CODES.planRequired);
  });
});
