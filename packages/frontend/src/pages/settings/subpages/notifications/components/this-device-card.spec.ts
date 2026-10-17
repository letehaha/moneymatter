import notificationsEn from '@/i18n/locales/chunks/en/settings/notifications.json';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import ThisDeviceCard from './this-device-card.vue';

const { mockTurnOn, mockTurnOff, webPush } = await vi.hoisted(async () => {
  const { ref } = await import('vue');

  return {
    mockTurnOn: vi.fn(),
    mockTurnOff: vi.fn(),
    webPush: { state: ref('off'), isPending: ref(false), needsTapAgain: ref(false) },
  };
});

vi.mock('@/composable/use-web-push', () => ({ useWebPush: () => webPush }));
vi.mock('../use-push-actions', () => ({
  usePushActions: () => ({ turnOn: mockTurnOn, turnOff: mockTurnOff }),
}));
vi.mock('@/common/utils/push-blocked-hint', () => ({ getPushBlockedHintKey: () => 'firefox' }));

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: notificationsEn } });
const T = notificationsEn.settings.notifications.thisDevice;

const setState = ({ state, isPending = false, needsTapAgain = false }: Record<string, unknown>) => {
  webPush.state.value = state as string;
  webPush.isPending.value = isPending as boolean;
  webPush.needsTapAgain.value = needsTapAgain as boolean;
};

const mountCard = () => mount(ThisDeviceCard, { global: { plugins: [i18n] } });

describe('this-device-card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setState({ state: 'off' });
  });

  it('explains an unsupported browser and offers no toggle', () => {
    setState({ state: 'unsupported' });
    const wrapper = mountCard();

    expect(wrapper.text()).toContain(T.unsupported);
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
  });

  it('tells iOS users to add the app to the Home Screen first, with no toggle', () => {
    setState({ state: 'needs-home-screen' });
    const wrapper = mountCard();

    expect(wrapper.text()).toContain(T.needsHomeScreen);
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
  });

  it('shows the toggle off for the default permission and turns notifications on from it', async () => {
    const wrapper = mountCard();
    const toggle = wrapper.get('[role="switch"]');

    expect(toggle.attributes('aria-checked')).toBe('false');

    await toggle.trigger('click');

    expect(mockTurnOn).toHaveBeenCalledTimes(1);
    expect(mockTurnOff).not.toHaveBeenCalled();
  });

  it('shows the blocked hint of the browser family and disables the toggle when denied', () => {
    setState({ state: 'denied' });
    const wrapper = mountCard();

    expect(wrapper.text()).toContain(T.denied);
    expect(wrapper.text()).toContain(T.blockedHint.firefox);
    expect(wrapper.get('[role="switch"]').attributes('disabled')).toBeDefined();
  });

  it('shows the toggle on when subscribed and turns notifications off from it', async () => {
    setState({ state: 'on' });
    const wrapper = mountCard();
    const toggle = wrapper.get('[role="switch"]');

    expect(toggle.attributes('aria-checked')).toBe('true');

    await toggle.trigger('click');

    expect(mockTurnOff).toHaveBeenCalledTimes(1);
    expect(mockTurnOn).not.toHaveBeenCalled();
  });

  it('shows a spinner and locks the toggle while the work is pending', () => {
    setState({ state: 'off', isPending: true });
    const wrapper = mountCard();

    expect(wrapper.find('[data-testid="push-pending"]').exists()).toBe(true);
    expect(wrapper.get('[role="switch"]').attributes('disabled')).toBeDefined();
  });

  it('shows a skeleton while the browser is still being checked', () => {
    setState({ state: 'checking' });
    const wrapper = mountCard();

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true);
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
  });

  it('asks the user to tap again after a stale subscription was removed', async () => {
    setState({ state: 'off', needsTapAgain: true });
    const wrapper = mountCard();
    await flushPromises();

    expect(wrapper.text()).toContain(T.tapAgain);
  });
});
