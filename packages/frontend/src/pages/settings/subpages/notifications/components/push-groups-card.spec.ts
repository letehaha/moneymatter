import { getUserSettings, patchUserSettings } from '@/api/user-settings';
import notificationsEn from '@/i18n/locales/chunks/en/settings/notifications.json';
import { PUSH_GROUPS } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import PushGroupsCard from './push-groups-card.vue';

vi.mock('@/api/user-settings', () => ({
  getUserSettings: vi.fn(),
  patchUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
}));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification: vi.fn() }),
}));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { ...notificationsEn, common: { errors: { settingsSaveFailed: 'Could not save' } } } },
});
const ITEMS = notificationsEn.settings.notifications.groups.items;

const mountCard = async ({ settings = {} }: { settings?: Record<string, unknown> } = {}) => {
  vi.mocked(getUserSettings).mockResolvedValue(settings);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = mount(PushGroupsCard, { global: { plugins: [i18n, [VueQueryPlugin, { queryClient }]] } });
  await flushPromises();

  return wrapper;
};

const switchOf = ({ wrapper, group }: { wrapper: Awaited<ReturnType<typeof mountCard>>; group: string }) =>
  wrapper.get(`[data-testid="push-group-${group}"] [role="switch"]`);

describe('push-groups-card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the five groups with their descriptions', async () => {
    const wrapper = await mountCard();

    expect(wrapper.findAll('[role="switch"]')).toHaveLength(5);
    Object.values(PUSH_GROUPS).forEach((group) => {
      expect(wrapper.text()).toContain(ITEMS[group].label);
      expect(wrapper.text()).toContain(ITEMS[group].description);
    });
  });

  it('starts with releases off and every other group on when nothing was saved', async () => {
    const wrapper = await mountCard();

    expect(switchOf({ wrapper, group: 'releases' }).attributes('aria-checked')).toBe('false');
    (['reminders', 'bankSync', 'sharing', 'system'] as const).forEach((group) => {
      expect(switchOf({ wrapper, group }).attributes('aria-checked')).toBe('true');
    });
  });

  it('shows the saved value of a group', async () => {
    const wrapper = await mountCard({
      settings: { notifications: { push: { groups: { reminders: false, releases: true } } } },
    });

    expect(switchOf({ wrapper, group: 'reminders' }).attributes('aria-checked')).toBe('false');
    expect(switchOf({ wrapper, group: 'releases' }).attributes('aria-checked')).toBe('true');
  });

  it('patches only the toggled group and flips the switch before the server answers', async () => {
    vi.mocked(patchUserSettings).mockReturnValue(new Promise(() => undefined));
    const wrapper = await mountCard();

    await switchOf({ wrapper, group: 'releases' }).trigger('click');
    await flushPromises();

    // TanStack passes its mutation context as a second argument, so only the patch is compared.
    expect(vi.mocked(patchUserSettings).mock.calls[0]?.[0]).toEqual({
      notifications: { push: { groups: { releases: true } } },
    });
    expect(switchOf({ wrapper, group: 'releases' }).attributes('aria-checked')).toBe('true');
  });

  it('puts the switch back when the save fails', async () => {
    vi.mocked(patchUserSettings).mockRejectedValue(new Error('500'));
    const wrapper = await mountCard();

    await switchOf({ wrapper, group: 'system' }).trigger('click');
    await flushPromises();

    expect(switchOf({ wrapper, group: 'system' }).attributes('aria-checked')).toBe('true');
  });
});
