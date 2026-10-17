import { ROUTES_NAMES } from '@/routes/constants';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import Settings from './settings.vue';

const { mockPushConfig } = vi.hoisted(() => ({ mockPushConfig: { enabled: false as boolean | undefined } }));

vi.mock('@/composable/data-queries/web-push', async () => {
  const { computed } = await import('vue');
  return {
    usePushConfig: () => ({
      config: computed(() =>
        mockPushConfig.enabled === undefined ? undefined : { enabled: mockPushConfig.enabled, vapidPublicKey: 'k' },
      ),
    }),
  };
});
vi.mock('@/stores', async () => {
  const { ref } = await import('vue');
  return { useUserStore: () => ({ user: ref({ isAdmin: false }), canSeeBilling: ref(false) }) };
});
vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return { ...original, storeToRefs: (store: Record<string, unknown>) => store };
});
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ name: ROUTES_NAMES.settings }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/composable/window-breakpoints', () => ({
  CUSTOM_BREAKPOINTS: { uiMobile: 'uiMobile' },
  useWindowBreakpoints: () => false,
}));
vi.mock('@/components/lib/ui/tooltip', async () => {
  const { defineComponent } = await import('vue');
  return {
    DesktopOnlyTooltip: defineComponent({
      inheritAttrs: false,
      name: 'DesktopOnlyTooltipStub',
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { settings: { navigation: { notifications: 'Notifications-tab', security: 'Security-tab' } } } },
});

const mountSettings = () =>
  mount(Settings, {
    global: {
      plugins: [i18n],
      stubs: {
        RouterLink: { props: ['to'], template: '<a data-testid="tab"><slot /></a>' },
        RouterView: true,
        ScrollArea: { template: '<div><slot /></div>' },
      },
    },
  });

describe('settings navigation', () => {
  it('lists the Notifications tab when the instance has push enabled', () => {
    mockPushConfig.enabled = true;

    expect(mountSettings().text()).toContain('Notifications-tab');
  });

  it('hides the Notifications tab when the instance has no push keys', () => {
    mockPushConfig.enabled = false;
    const wrapper = mountSettings();

    expect(wrapper.text()).toContain('Security-tab');
    expect(wrapper.text()).not.toContain('Notifications-tab');
  });

  it('hides the Notifications tab until the config has loaded', () => {
    mockPushConfig.enabled = undefined;

    expect(mountSettings().text()).not.toContain('Notifications-tab');
  });
});
