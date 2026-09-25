import { FEATURES, USER_ROLES, type Entitlements, type Feature, type UserModel } from '@bt/shared/types';
import { createTestingPinia } from '@pinia/testing';
import { USER } from '@tests/mocks';
import { RouterLinkStub, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import PlanRestricted from './plan-restricted.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      billing: {
        seePlans: 'See plans',
        planRequired: {
          essential: 'Essential plan required',
          plus: 'Plus plan required',
          hint: 'Pick a plan to unlock it.',
        },
      },
    },
  },
});

const buildEntitlements = (features: Feature[]): Entitlements => ({
  features,
  readOnly: false,
  seats: 1,
  plan: null,
  trialEndsAt: null,
  budgetPlanTrialEndsAt: null,
  subscriptions: [],
  trialUsage: {},
  featureTrials: {},
});

const mountRestricted = ({
  feature,
  user,
  overlay,
  hint,
}: {
  feature: Feature;
  user: UserModel | null;
  overlay?: boolean;
  hint?: string;
}) =>
  mount(PlanRestricted, {
    props: { feature, overlay, hint },
    slots: { default: '<p data-test="gated">gated content</p>' },
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false, initialState: { user: { user } } }), i18n],
      stubs: { RouterLink: RouterLinkStub },
    },
  });

describe('PlanRestricted', () => {
  afterEach(() => {
    delete window.__APP_CONFIG__;
  });

  it('renders the slot untouched for a demo account', () => {
    const wrapper = mountRestricted({
      feature: FEATURES.data_export,
      user: { ...USER, role: USER_ROLES.demo, entitlements: buildEntitlements([]) },
    });

    expect(wrapper.find('[data-test="gated"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('plan required');
  });

  it('renders the slot untouched while the user is still loading', () => {
    const wrapper = mountRestricted({ feature: FEATURES.data_export, user: null });

    expect(wrapper.find('[data-test="gated"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('plan required');
  });

  it('renders the slot untouched when the feature is entitled', () => {
    const wrapper = mountRestricted({
      feature: FEATURES.data_export,
      user: { ...USER, entitlements: buildEntitlements([FEATURES.data_export]) },
    });

    expect(wrapper.find('[data-test="gated"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('plan required');
  });

  it('keeps the slot visible but inert behind the overlay prompt', () => {
    const wrapper = mountRestricted({
      feature: FEATURES.data_export,
      user: { ...USER, entitlements: buildEntitlements([]) },
      overlay: true,
    });

    const inert = wrapper.find('[inert]');
    expect(inert.exists()).toBe(true);
    expect(inert.find('[data-test="gated"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Essential plan required');
  });

  it('names the required plan but hides the link on a self-hosted install', () => {
    window.__APP_CONFIG__ = { IS_SELF_HOST: 'true' };

    const wrapper = mountRestricted({
      feature: FEATURES.data_export,
      user: { ...USER, entitlements: buildEntitlements([]) },
    });

    expect(wrapper.text()).toContain('Essential plan required');
    expect(wrapper.text()).not.toContain('See plans');
  });

  it('shows a custom hint in both the callout and the overlay', () => {
    const user = { ...USER, entitlements: buildEntitlements([]) };
    const hint = 'Your free tries ran out.';

    expect(mountRestricted({ feature: FEATURES.data_export, user, hint }).text()).toContain(hint);
    expect(mountRestricted({ feature: FEATURES.data_export, user, hint, overlay: true }).text()).toContain(hint);
  });

  it('falls back to the generic hint when none is given', () => {
    const user = { ...USER, entitlements: buildEntitlements([]) };

    expect(mountRestricted({ feature: FEATURES.data_export, user }).text()).toContain('Pick a plan to unlock it.');
    expect(mountRestricted({ feature: FEATURES.data_export, user, overlay: true }).text()).toContain(
      'Pick a plan to unlock it.',
    );
  });

  it('names Essential for an Essential feature and Plus for a Plus one', () => {
    const user = { ...USER, entitlements: buildEntitlements([]) };

    expect(mountRestricted({ feature: FEATURES.data_export, user }).text()).toContain('Essential plan required');
    expect(mountRestricted({ feature: FEATURES.bank_providers, user }).text()).toContain('Plus plan required');
  });
});
