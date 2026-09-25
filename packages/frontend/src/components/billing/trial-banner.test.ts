import {
  SUBSCRIPTION_STATUSES,
  USER_ROLES,
  type BillingSubscriptionSummary,
  type Entitlements,
  type UserModel,
} from '@bt/shared/types';
import { createTestingPinia } from '@pinia/testing';
import { USER } from '@tests/mocks';
import { RouterLinkStub, mount } from '@vue/test-utils';
import { addDays } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import TrialBanner from './trial-banner.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      billing: {
        seePlans: 'See plans',
        updatePaymentMethod: 'Update payment method',
        banner: {
          readOnly: 'Your trial is over. {link}',
          subscriptionEnded: 'Your subscription ended. {link}',
          pastDue: 'Your payment failed. {link}',
          trial: '{count} day left. {link} | {count} days left. {link}',
        },
      },
    },
  },
});

const subscription = ({ status }: { status: BillingSubscriptionSummary['status'] }): BillingSubscriptionSummary => ({
  externalSubscriptionId: `sub_${status}`,
  tier: 'plus',
  status,
  billingCycle: 'month',
  currentPeriodEndsAt: addDays(new Date(), 30).toISOString(),
  scheduledChange: null,
});

const userWith = (overrides: Partial<Entitlements>): UserModel => ({
  ...USER,
  entitlements: {
    features: [],
    readOnly: false,
    seats: 1,
    plan: null,
    trialEndsAt: null,
    budgetPlanTrialEndsAt: null,
    subscriptions: [],
    trialUsage: {},
    featureTrials: {},
    ...overrides,
  },
});

const mountBanner = (user: UserModel | null) =>
  mount(TrialBanner, {
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false, initialState: { user: { user } } }), i18n],
      stubs: { RouterLink: RouterLinkStub },
    },
  });

describe('TrialBanner', () => {
  it('renders nothing for an entitled user', () => {
    expect(mountBanner(userWith({})).find('div').exists()).toBe(false);
  });

  it('prefers the read-only message over past-due and trial', () => {
    const wrapper = mountBanner(
      userWith({
        readOnly: true,
        trialEndsAt: addDays(new Date(), 3).toISOString(),
        subscriptions: [subscription({ status: SUBSCRIPTION_STATUSES.past_due })],
      }),
    );

    expect(wrapper.text()).toContain('Your subscription ended.');
  });

  it('uses the trial copy for a read-only user who never subscribed', () => {
    const wrapper = mountBanner(userWith({ readOnly: true }));

    expect(wrapper.text()).toContain('Your trial is over.');
  });

  it('prefers past-due over a running trial', () => {
    const wrapper = mountBanner(
      userWith({
        trialEndsAt: addDays(new Date(), 3).toISOString(),
        subscriptions: [subscription({ status: SUBSCRIPTION_STATUSES.past_due })],
      }),
    );

    expect(wrapper.text()).toContain('Your payment failed.');
    expect(wrapper.text()).toContain('Update payment method');
  });

  it('still renders on the last day of the trial', () => {
    const wrapper = mountBanner(userWith({ trialEndsAt: new Date().toISOString() }));

    expect(wrapper.text()).toContain('0 days left.');
    expect(wrapper.text()).toContain('See plans');
  });

  it('renders nothing for an account that cannot reach the plan page', () => {
    const wrapper = mountBanner({
      ...userWith({ trialEndsAt: addDays(new Date(), 3).toISOString() }),
      role: USER_ROLES.demo,
    });

    expect(wrapper.find('div').exists()).toBe(false);
  });
});
