import { DEMO_SESSION_EXPIRED_REASON } from '@/common/const';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAuthStore, useUserStore } from '@/stores';
import { DEMO_EXPIRY_HOURS } from '@bt/shared/const/demo';
import { UserInfoResponse, type RecordId } from '@bt/shared/types';
import { createTestingPinia } from '@pinia/testing';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { subHours } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';

import DemoBanner from './demo-banner.vue';

// Mock posthog
vi.mock('@/lib/posthog', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/lib/sentry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sentry')>()),
  captureException: vi.fn(),
}));

// Create a mock router
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
    { path: '/sign-up', name: ROUTES_NAMES.signUp, component: { template: '<div>Sign Up</div>' } },
    { path: '/sign-in', name: ROUTES_NAMES.signIn, component: { template: '<div>Sign In</div>' } },
  ],
});

// Create i18n instance for tests
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      demo: {
        banner: {
          message: "You're exploring a demo{time}. {signUpLink} to keep your data permanently.",
          resets: 'resets in {time}',
          signUp: 'Sign up',
          timeFormat: {
            hoursMinutes: '{hours}h {minutes}m',
            minutes: '{minutes}m',
          },
        },
      },
    },
  },
});

const demoUser: UserInfoResponse = {
  id: 1,
  username: 'demo',
  email: 'demo@demo.local',
  firstName: '',
  lastName: '',
  middleName: '',
  avatar: '',
  totalBalance: 0,
  defaultCategoryId: '00000000-0000-0000-0000-000000000001' as RecordId,
  role: 'demo',
  appStoreAccountToken: '00000000-0000-4000-8000-000000000001',
  createdAt: new Date(),
};

// Past the fixed demo window, so `isExpired` flips as soon as the store holds this user.
const expiredDemoUser: UserInfoResponse = {
  ...demoUser,
  createdAt: subHours(new Date(), DEMO_EXPIRY_HOURS + 1),
};

const regularUser: UserInfoResponse = {
  id: 1,
  username: 'regular',
  email: 'user@example.com',
  firstName: '',
  lastName: '',
  middleName: '',
  avatar: '',
  totalBalance: 0,
  defaultCategoryId: '00000000-0000-0000-0000-000000000001' as RecordId,
  role: 'common',
  appStoreAccountToken: '00000000-0000-4000-8000-000000000001',
  createdAt: new Date(),
};

describe('DemoBanner component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The expiry tests spy on the shared router instance.
    vi.restoreAllMocks();
  });

  const mountComponent = (userData: UserInfoResponse | null = null) => {
    const pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
      initialState: {
        user: { user: userData },
      },
    });

    const wrapper = mount(DemoBanner, {
      global: {
        plugins: [pinia, VueQueryPlugin, router, i18n],
      },
    });

    // Mock auth store methods after mount
    const authStore = useAuthStore();
    authStore.logout = vi.fn().mockResolvedValue(undefined);

    return wrapper;
  };

  describe('visibility', () => {
    it('renders when user is a demo user', async () => {
      const wrapper = mountComponent(demoUser);

      expect(wrapper.find('div').exists()).toBe(true);
      expect(wrapper.text()).toContain("You're exploring a demo");
    });

    it('does not render when user is not a demo user', () => {
      const wrapper = mountComponent(regularUser);

      expect(wrapper.find('div').exists()).toBe(false);
    });

    it('does not render when user is null', () => {
      const wrapper = mountComponent(null);

      expect(wrapper.find('div').exists()).toBe(false);
    });
  });

  describe('content', () => {
    it('displays the demo message', () => {
      const wrapper = mountComponent(demoUser);

      expect(wrapper.text()).toContain("You're exploring a demo");
      expect(wrapper.text()).toContain('Sign up');
      expect(wrapper.text()).toContain('to keep your data permanently');
    });

    it('contains a sign up button', () => {
      const wrapper = mountComponent(demoUser);

      const button = wrapper.find('button');
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('Sign up');
    });
  });

  describe('analytics', () => {
    it('tracks analytics event when sign up button is clicked', async () => {
      const { trackAnalyticsEvent } = await import('@/lib/posthog');

      const wrapper = mountComponent(demoUser);
      const button = wrapper.find('button');

      await button.trigger('click');

      expect(trackAnalyticsEvent).toHaveBeenCalledWith({
        event: 'demo_signup_clicked',
        properties: { location: 'banner' },
      });
    });
  });

  describe('expiry auto-logout', () => {
    // Mounting with a still-valid user and ageing it afterwards keeps the stubbed
    // `logout` in place before the watcher can fire.
    const expireAfterMount = async () => {
      mountComponent(demoUser);

      const authStore = useAuthStore();
      const pushSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined);

      useUserStore().user = expiredDemoUser;
      await flushPromises();

      return { authStore, pushSpy };
    };

    it('logs the user out and sends them to sign-in with the expired reason', async () => {
      const { authStore, pushSpy } = await expireAfterMount();

      expect(authStore.logout).toHaveBeenCalledWith({ demoEndReason: 'expired' });
      expect(pushSpy).toHaveBeenCalledWith({
        name: ROUTES_NAMES.signIn,
        query: { reason: DEMO_SESSION_EXPIRED_REASON },
      });
    });

    it('still redirects and reports the failure when logout rejects', async () => {
      const { captureException } = await import('@/lib/sentry');

      mountComponent(demoUser);

      const authStore = useAuthStore();
      authStore.logout = vi.fn().mockRejectedValue(new Error('signOut failed'));
      const pushSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined);

      useUserStore().user = expiredDemoUser;
      await flushPromises();

      expect(captureException).toHaveBeenCalled();
      expect(pushSpy).toHaveBeenCalledWith({
        name: ROUTES_NAMES.signIn,
        query: { reason: DEMO_SESSION_EXPIRED_REASON },
      });
    });
  });
});
