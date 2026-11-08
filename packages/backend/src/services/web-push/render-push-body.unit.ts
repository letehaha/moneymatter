import { NOTIFICATION_TYPES, type NotificationType, SHARE_NOTIFICATION_TYPES } from '@bt/shared/types';
import { i18nextReady } from '@i18n/index';
import { beforeAll, describe, expect, it } from '@jest/globals';

import { renderPushBody } from './render-push-body';

type RenderInput = Parameters<typeof renderPushBody>[0]['notification'];

const notification = ({
  type,
  message = null,
  payload = {},
}: {
  type: NotificationType;
  message?: string | null;
  payload?: Record<string, unknown>;
}): RenderInput => ({ type, message, payload });

const money = ({ locale, amount, currency }: { locale: string; amount: number; currency: string }) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);

describe('renderPushBody', () => {
  beforeAll(async () => {
    await i18nextReady;
  });

  describe('changelog', () => {
    it('is the release name', () => {
      const body = renderPushBody({
        notification: notification({
          type: NOTIFICATION_TYPES.changelog,
          payload: { version: 'v1.2.0', releaseName: 'Autumn release' },
        }),
        locale: 'en',
      });
      expect(body).toBe('Autumn release');
    });

    it('is the same release name in uk', () => {
      const body = renderPushBody({
        notification: notification({
          type: NOTIFICATION_TYPES.changelog,
          payload: { version: 'v1.2.0', releaseName: 'Autumn release' },
        }),
        locale: 'uk',
      });
      expect(body).toBe('Autumn release');
    });

    it('has no body without a release name', () => {
      expect(
        renderPushBody({
          notification: notification({ type: NOTIFICATION_TYPES.changelog, payload: { version: 'v1.2.0' } }),
          locale: 'en',
        }),
      ).toBeNull();
    });
  });

  describe('tag reminder', () => {
    const threshold = (payload: Record<string, unknown> = {}) =>
      notification({
        type: NOTIFICATION_TYPES.tagReminder,
        message: 'stored message that is ignored',
        payload: {
          tagName: 'Groceries',
          reminderType: 'amount_threshold',
          actualAmount: 1234.5,
          thresholdAmount: 1000,
          currencyCode: 'EUR',
          ...payload,
        },
      });

    it('renders the threshold case in the payload currency (en)', () => {
      const expected = `Groceries · spent ${money({ locale: 'en', amount: 1234.5, currency: 'EUR' })} (threshold: ${money({ locale: 'en', amount: 1000, currency: 'EUR' })})`;
      expect(renderPushBody({ notification: threshold(), locale: 'en' })).toBe(expected);
    });

    it('renders the threshold case in uk with the uk wording and number format', () => {
      const body = renderPushBody({ notification: threshold(), locale: 'uk' });
      expect(body).toBe(
        `Groceries · витрачено ${money({ locale: 'uk', amount: 1234.5, currency: 'EUR' })} (поріг: ${money({ locale: 'uk', amount: 1000, currency: 'EUR' })})`,
      );
    });

    it('formats in USD when the payload has no currency code', () => {
      const body = renderPushBody({ notification: threshold({ currencyCode: undefined }), locale: 'en' });
      expect(body).toBe(
        `Groceries · spent ${money({ locale: 'en', amount: 1234.5, currency: 'USD' })} (threshold: ${money({ locale: 'en', amount: 1000, currency: 'USD' })})`,
      );
    });

    it('prints the number plus the code for a custom code that Intl rejects', () => {
      const body = renderPushBody({ notification: threshold({ currencyCode: 'MYCOIN' }), locale: 'en' });
      expect(body).toBe('Groceries · spent 1,234.5 MYCOIN (threshold: 1,000 MYCOIN)');
    });

    it('leaves an amount empty when the payload lacks it, as the bell does', () => {
      const body = renderPushBody({ notification: threshold({ actualAmount: undefined }), locale: 'en' });
      expect(body).toBe(`Groceries · spent  (threshold: ${money({ locale: 'en', amount: 1000, currency: 'EUR' })})`);
    });

    it.each([
      [1, 'Groceries · 1 transaction', 'Groceries · 1 транзакція'],
      [3, 'Groceries · 3 transactions', 'Groceries · 3 транзакції'],
      [5, 'Groceries · 5 transactions', 'Groceries · 5 транзакцій'],
      [0, 'Groceries · 0 transactions', 'Groceries · 0 транзакцій'],
    ])('renders the existence case for a count of %i', (count, en, uk) => {
      const input = notification({
        type: NOTIFICATION_TYPES.tagReminder,
        payload: { tagName: 'Groceries', reminderType: 'existence_check', transactionCount: count },
      });
      expect(renderPushBody({ notification: input, locale: 'en' })).toBe(en);
      expect(renderPushBody({ notification: input, locale: 'uk' })).toBe(uk);
    });

    it('treats a missing count as zero', () => {
      const input = notification({
        type: NOTIFICATION_TYPES.tagReminder,
        payload: { tagName: 'Groceries', reminderType: 'existence_check' },
      });
      expect(renderPushBody({ notification: input, locale: 'en' })).toBe('Groceries · 0 transactions');
    });

    it('gives the tag name alone for an unknown reminder type', () => {
      const input = notification({
        type: NOTIFICATION_TYPES.tagReminder,
        payload: { tagName: 'Groceries', reminderType: 'something_else' },
      });
      expect(renderPushBody({ notification: input, locale: 'en' })).toBe('Groceries');
    });

    it('has no body without a tag name or a known reminder type', () => {
      expect(
        renderPushBody({
          notification: notification({ type: NOTIFICATION_TYPES.tagReminder, payload: {} }),
          locale: 'en',
        }),
      ).toBeNull();
    });
  });

  describe('share and household types', () => {
    const SEND_FAILED_TYPES: NotificationType[] = [
      NOTIFICATION_TYPES.shareInvitationSendFailed,
      NOTIFICATION_TYPES.householdInvitationSendFailed,
    ];
    const RECEIVED_TYPES: NotificationType[] = [
      NOTIFICATION_TYPES.shareInvitationReceived,
      NOTIFICATION_TYPES.householdInvitationReceived,
    ];
    const LIFECYCLE_TYPES = SHARE_NOTIFICATION_TYPES.filter(
      (type) => !SEND_FAILED_TYPES.includes(type) && !RECEIVED_TYPES.includes(type),
    );

    it('renders a received invitation as @owner · resource', () => {
      for (const type of RECEIVED_TYPES) {
        const body = renderPushBody({
          notification: notification({
            type,
            payload: { owner: { id: 1, username: 'alice', avatar: null }, resourceName: 'Main account' },
          }),
          locale: 'en',
        });
        expect(body).toBe('@alice · Main account');
      }
    });

    it('renders a send-failed invitation with the registered invitee and the hint line', () => {
      const payload = {
        inviteeEmail: 'bob@example.com',
        inviteeSnapshot: { id: 2, username: 'bob', avatar: null },
        resourceName: 'Main account',
      };
      for (const type of SEND_FAILED_TYPES) {
        expect(renderPushBody({ notification: notification({ type, payload }), locale: 'en' })).toBe(
          '@bob · Main account\nOpen the sharing panel to resend.',
        );
        expect(renderPushBody({ notification: notification({ type, payload }), locale: 'uk' })).toBe(
          '@bob · Main account\nВідкрийте панель спільного доступу, щоб надіслати повторно.',
        );
      }
    });

    it('falls back to the invitee email when there is no registered invitee', () => {
      const body = renderPushBody({
        notification: notification({
          type: NOTIFICATION_TYPES.shareInvitationSendFailed,
          payload: { inviteeEmail: 'bob@example.com', inviteeSnapshot: null, resourceName: 'Main account' },
        }),
        locale: 'en',
      });
      expect(body).toBe('bob@example.com · Main account\nOpen the sharing panel to resend.');
    });

    it('renders a lifecycle notification as @counterpart · resource', () => {
      for (const type of LIFECYCLE_TYPES) {
        const body = renderPushBody({
          notification: notification({
            type,
            payload: { counterpartUser: { id: 3, username: 'carol', avatar: null }, resourceName: 'Main account' },
          }),
          locale: 'en',
        });
        expect(body).toBe('@carol · Main account');
      }
    });

    it('leaves a missing counterpart out', () => {
      const body = renderPushBody({
        notification: notification({
          type: NOTIFICATION_TYPES.shareAccepted,
          payload: { resourceName: 'Main account' },
        }),
        locale: 'en',
      });
      expect(body).toBe('Main account');
    });

    it('leaves a missing resource name out', () => {
      const body = renderPushBody({
        notification: notification({
          type: NOTIFICATION_TYPES.shareAccepted,
          payload: { counterpartUser: { id: 3, username: 'carol', avatar: null } },
        }),
        locale: 'en',
      });
      expect(body).toBe('@carol');
    });

    it('has no body for an empty payload, even for the send-failed types', () => {
      for (const type of SHARE_NOTIFICATION_TYPES) {
        expect(renderPushBody({ notification: notification({ type, payload: {} }), locale: 'en' })).toBeNull();
      }
    });

    it('renders every listed share and household type from its payload shape', () => {
      expect(SHARE_NOTIFICATION_TYPES).toHaveLength(18);

      for (const type of SHARE_NOTIFICATION_TYPES) {
        const payload = {
          owner: { id: 1, username: 'owner', avatar: null },
          inviteeSnapshot: { id: 2, username: 'invitee', avatar: null },
          counterpartUser: { id: 3, username: 'counterpart', avatar: null },
          resourceName: 'Thing',
        };
        const body = renderPushBody({ notification: notification({ type, payload }), locale: 'en' });

        const counterpart = RECEIVED_TYPES.includes(type)
          ? '@owner'
          : SEND_FAILED_TYPES.includes(type)
            ? '@invitee'
            : '@counterpart';
        const hint = SEND_FAILED_TYPES.includes(type) ? '\nOpen the sharing panel to resend.' : '';
        expect(body).toBe(`${counterpart} · Thing${hint}`);
      }
    });

    it('uses one exported list: every share_ and household_ type is in it except share_owner_tracker_deleted', () => {
      const shareLike = Object.values(NOTIFICATION_TYPES).filter(
        (type) => type.startsWith('share_') || type.startsWith('household_'),
      );
      const excluded: NotificationType[] = [NOTIFICATION_TYPES.shareOwnerTrackerDeleted];

      expect(shareLike.filter((type) => !SHARE_NOTIFICATION_TYPES.includes(type))).toEqual(excluded);
      expect(SHARE_NOTIFICATION_TYPES.filter((type) => !shareLike.includes(type))).toEqual([]);
    });
  });

  describe('every other type', () => {
    it('is the stored message', () => {
      const body = renderPushBody({
        notification: notification({
          type: NOTIFICATION_TYPES.subscriptionReminder,
          message: '"Apple Music" is due on 2026-10-20',
        }),
        locale: 'en',
      });
      expect(body).toBe('"Apple Music" is due on 2026-10-20');
    });

    it('has no body for a null or empty message', () => {
      expect(
        renderPushBody({
          notification: notification({ type: NOTIFICATION_TYPES.plannedConfirmed, message: null }),
          locale: 'en',
        }),
      ).toBeNull();
      expect(
        renderPushBody({
          notification: notification({ type: NOTIFICATION_TYPES.plannedConfirmed, message: '' }),
          locale: 'en',
        }),
      ).toBeNull();
    });

    it('uses the stored message for share_owner_tracker_deleted, not the share renderer', () => {
      const body = renderPushBody({
        notification: notification({
          type: NOTIFICATION_TYPES.shareOwnerTrackerDeleted,
          message: 'alice deleted the budget Holiday',
          payload: { counterpartUser: { id: 3, username: 'carol', avatar: null }, resourceName: 'Holiday' },
        }),
        locale: 'en',
      });
      expect(body).toBe('alice deleted the budget Holiday');
    });
  });
});
