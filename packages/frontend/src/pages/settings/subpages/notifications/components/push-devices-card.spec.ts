import { getPushDevices, removePushDevice, sendTestPush } from '@/api/web-push';
import notificationsEn from '@/i18n/locales/chunks/en/settings/notifications.json';
import type { PushDeviceDto } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import PushDevicesCard from './push-devices-card.vue';

const { mockTurnOn, mockDisable, mockSuccess, mockError, mockWarning, webPush } = await vi.hoisted(async () => {
  const { ref } = await import('vue');

  return {
    mockTurnOn: vi.fn(),
    mockDisable: vi.fn(),
    mockSuccess: vi.fn(),
    mockError: vi.fn(),
    mockWarning: vi.fn(),
    webPush: { state: ref('off') },
  };
});

vi.mock('@/api/web-push', () => ({
  getPushConfig: vi.fn(),
  getPushDevices: vi.fn(),
  removePushDevice: vi.fn(),
  sendTestPush: vi.fn(),
}));
vi.mock('@/composable/use-web-push', () => ({
  useWebPush: () => ({
    state: webPush.state,
    disable: mockDisable,
    isThisDevice: ({ endpointHash }: { endpointHash: string }) => endpointHash === 'hash-this',
  }),
}));
vi.mock('../use-push-actions', () => ({ usePushActions: () => ({ turnOn: mockTurnOn }) }));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: mockSuccess,
    addErrorNotification: mockError,
    addWarningNotification: mockWarning,
  }),
}));

// The tooltip needs its provider and has no part in these cases.
vi.mock('@/components/lib/ui/tooltip', async () => {
  const { defineComponent } = await import('vue');
  return {
    DesktopOnlyTooltip: defineComponent({
      name: 'DesktopOnlyTooltipStub',
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  };
});

// The dialog's own chrome (drawer on mobile) is not under test: it renders its slots while open.
vi.mock('@/components/common/responsive-alert-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'ResponsiveAlertDialogStub',
      props: { open: { type: Boolean, default: false }, confirmVariant: { type: String, default: 'default' } },
      emits: ['update:open', 'confirm'],
      setup(props, { emit, slots }) {
        return () =>
          props.open
            ? h('div', { 'data-testid': 'dialog', 'data-confirm-variant': props.confirmVariant }, [
                slots.title?.(),
                slots.description?.(),
                h('button', { 'data-testid': 'confirm', onClick: () => emit('confirm') }),
              ])
            : null;
      },
    }),
  };
});

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: notificationsEn } });
const D = notificationsEn.settings.notifications.devices;

const buildDevice = (patch: Partial<PushDeviceDto> = {}): PushDeviceDto => ({
  id: 'dev-other',
  deviceLabel: 'Chrome on Windows',
  endpointHost: 'fcm.googleapis.com',
  endpointHash: 'hash-other',
  createdAt: '2026-10-01T10:00:00.000Z',
  lastSeenAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  failureCount: 0,
  ...patch,
});

const THIS_DEVICE = buildDevice({
  id: 'dev-this',
  deviceLabel: 'Safari on Mac',
  endpointHash: 'hash-this',
  lastSuccessAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
});
const OTHER_DEVICE = buildDevice();

const mountCard = async ({ devices }: { devices: PushDeviceDto[] }) => {
  vi.mocked(getPushDevices).mockResolvedValue(devices);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = mount(PushDevicesCard, { global: { plugins: [i18n, [VueQueryPlugin, { queryClient }]] } });
  await flushPromises();

  return wrapper;
};

describe('push-devices-card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webPush.state.value = 'off';
  });

  describe('device list', () => {
    it('shows each label with the last delivery or Never, and marks this device', async () => {
      const wrapper = await mountCard({ devices: [THIS_DEVICE, OTHER_DEVICE] });

      const thisRow = wrapper.get('[data-testid="push-device-dev-this"]');
      const otherRow = wrapper.get('[data-testid="push-device-dev-other"]');

      expect(thisRow.text()).toContain('Safari on Mac');
      expect(thisRow.text()).toContain(D.thisDeviceBadge);
      expect(thisRow.text()).toContain('Last delivery');
      expect(thisRow.text()).toContain('ago');

      expect(otherRow.text()).toContain('Chrome on Windows');
      expect(otherRow.text()).not.toContain(D.thisDeviceBadge);
      expect(otherRow.text()).toContain(D.never);
    });

    it('names a device that has no label', async () => {
      const wrapper = await mountCard({ devices: [buildDevice({ deviceLabel: null })] });

      expect(wrapper.text()).toContain(D.unnamed);
    });
  });

  describe('removing a device', () => {
    it('asks for confirmation with a destructive confirm button before removing another device', async () => {
      vi.mocked(removePushDevice).mockResolvedValue(undefined);
      const wrapper = await mountCard({ devices: [THIS_DEVICE, OTHER_DEVICE] });

      expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(false);

      await wrapper.get('[data-testid="push-device-remove-dev-other"]').trigger('click');

      const dialog = wrapper.get('[data-testid="dialog"]');
      expect(dialog.attributes('data-confirm-variant')).toBe('destructive');
      expect(dialog.text()).toContain('Chrome on Windows');
      expect(removePushDevice).not.toHaveBeenCalled();

      await wrapper.get('[data-testid="confirm"]').trigger('click');
      await flushPromises();

      expect(removePushDevice).toHaveBeenCalledWith({ id: 'dev-other' });
      expect(mockDisable).not.toHaveBeenCalled();
      expect(mockSuccess).toHaveBeenCalledWith(D.toasts.removed);
      expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(false);
    });

    it('also unsubscribes the browser when the removed device is this one', async () => {
      mockDisable.mockResolvedValue(undefined);
      const wrapper = await mountCard({ devices: [THIS_DEVICE, OTHER_DEVICE] });

      await wrapper.get('[data-testid="push-device-remove-dev-this"]').trigger('click');

      expect(wrapper.get('[data-testid="dialog"]').text()).toContain(D.removeDialog.thisDeviceNote);

      await wrapper.get('[data-testid="confirm"]').trigger('click');
      await flushPromises();

      expect(mockDisable).toHaveBeenCalledTimes(1);
      expect(removePushDevice).not.toHaveBeenCalled();
      expect(mockSuccess).toHaveBeenCalledWith(D.toasts.removed);
    });

    it('keeps the device and shows an error toast when the removal fails', async () => {
      vi.mocked(removePushDevice).mockRejectedValue(new Error('500'));
      const wrapper = await mountCard({ devices: [OTHER_DEVICE] });

      await wrapper.get('[data-testid="push-device-remove-dev-other"]').trigger('click');
      await wrapper.get('[data-testid="confirm"]').trigger('click');
      await flushPromises();

      expect(mockError).toHaveBeenCalledWith(D.toasts.removeFailed);
      expect(mockSuccess).not.toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    it('explains that no device is registered and offers the enable action', async () => {
      const wrapper = await mountCard({ devices: [] });

      expect(wrapper.text()).toContain(D.empty.title);
      expect(wrapper.text()).toContain(D.empty.description);
      expect(wrapper.find('[data-testid="push-test"]').exists()).toBe(false);

      await wrapper.get('[data-testid="push-empty-enable"]').trigger('click');

      expect(mockTurnOn).toHaveBeenCalledTimes(1);
    });

    it('offers no enable action where this browser cannot turn notifications on', async () => {
      webPush.state.value = 'denied';
      const wrapper = await mountCard({ devices: [] });

      expect(wrapper.text()).toContain(D.empty.title);
      expect(wrapper.find('[data-testid="push-empty-enable"]').exists()).toBe(false);
    });
  });

  describe('test notification', () => {
    it('reports sent, failed and removed counts in a toast', async () => {
      vi.mocked(sendTestPush).mockResolvedValue({ sent: 2, failed: 0, removed: 1 });
      const wrapper = await mountCard({ devices: [THIS_DEVICE, OTHER_DEVICE] });

      await wrapper.get('[data-testid="push-test"]').trigger('click');
      await flushPromises();

      expect(sendTestPush).toHaveBeenCalledTimes(1);
      expect(mockSuccess).toHaveBeenCalledWith('Test notification: 2 sent, 0 failed, 1 removed');
    });

    it('uses a warning toast when nothing was delivered', async () => {
      vi.mocked(sendTestPush).mockResolvedValue({ sent: 0, failed: 1, removed: 0 });
      const wrapper = await mountCard({ devices: [OTHER_DEVICE] });

      await wrapper.get('[data-testid="push-test"]').trigger('click');
      await flushPromises();

      expect(mockWarning).toHaveBeenCalledWith('Test notification: 0 sent, 1 failed, 0 removed');
      expect(mockSuccess).not.toHaveBeenCalled();
    });

    it('is disabled while the request is pending', async () => {
      vi.mocked(sendTestPush).mockReturnValue(new Promise(() => undefined));
      const wrapper = await mountCard({ devices: [OTHER_DEVICE] });

      await wrapper.get('[data-testid="push-test"]').trigger('click');
      await flushPromises();

      expect(wrapper.get('[data-testid="push-test"]').attributes('disabled')).toBeDefined();
    });
  });
});
