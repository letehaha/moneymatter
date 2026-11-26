import { getNotificationChannels } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

describe('getNotificationChannels', () => {
  it('falls back to the category defaults', () => {
    expect(getNotificationChannels({ category: 'watchlistAlerts', preferences: undefined })).toEqual({
      inApp: true,
      push: true,
      email: true,
    });
    expect(getNotificationChannels({ category: 'unrealizedLoss', preferences: {} })).toEqual({
      inApp: true,
      push: true,
      email: false,
    });
    expect(getNotificationChannels({ category: 'invitations', preferences: {} }).email).toBe(false);
  });

  it('applies stored channels over the defaults', () => {
    expect(
      getNotificationChannels({
        category: 'subscriptionReminders',
        preferences: { subscriptionReminders: { push: false } },
      }),
    ).toEqual({ inApp: true, push: false, email: true });
  });

  it('keeps in-app on while push is on', () => {
    expect(
      getNotificationChannels({
        category: 'invitations',
        preferences: { invitations: { inApp: false, push: true } },
      }),
    ).toEqual({ inApp: true, push: true, email: false });
    expect(
      getNotificationChannels({
        category: 'invitations',
        preferences: { invitations: { inApp: false, push: false } },
      }),
    ).toEqual({ inApp: false, push: false, email: false });
  });

  it('turns every channel off for a disabled category', () => {
    expect(
      getNotificationChannels({
        category: 'watchlistAlerts',
        preferences: { watchlistAlerts: { enabled: false, inApp: true } },
      }),
    ).toEqual({ inApp: false, push: false, email: false });
  });
});
