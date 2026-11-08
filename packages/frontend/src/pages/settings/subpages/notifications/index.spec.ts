import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import NotificationsSettingsPage from './index.vue';

const { mockPrepare, webPush } = await vi.hoisted(async () => {
  const { ref } = await import('vue');

  return { mockPrepare: vi.fn(), webPush: { state: ref('off') } };
});

vi.mock('@/composable/use-web-push', () => ({ useWebPush: () => ({ state: webPush.state, prepare: mockPrepare }) }));

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } });

const mountPage = () =>
  mount(NotificationsSettingsPage, {
    global: {
      plugins: [i18n],
      stubs: {
        ThisDeviceCard: { template: '<div data-testid="this-device" />' },
        PushGroupsCard: { template: '<div data-testid="groups" />' },
        PushDevicesCard: { template: '<div data-testid="devices" />' },
      },
    },
  });

describe('notifications settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockResolvedValue(undefined);
    webPush.state.value = 'off';
  });

  it('prepares the worker registration once when it mounts', () => {
    mountPage();

    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });

  it('shows the three cards when the instance has push enabled', () => {
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="this-device"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="groups"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="devices"]').exists()).toBe(true);
  });

  it('shows only the not-set-up message when the instance has no push keys', () => {
    webPush.state.value = 'server-disabled';
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="push-server-disabled"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="this-device"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="groups"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="devices"]').exists()).toBe(false);
  });
});
