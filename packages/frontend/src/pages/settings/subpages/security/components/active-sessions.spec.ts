import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import ActiveSessions from './active-sessions.vue';

const { mockGetAuthSessions, mockGetSession, mockRevokeSession, mockRevokeOtherSessions } = vi.hoisted(() => ({
  mockGetAuthSessions: vi.fn(),
  mockGetSession: vi.fn(),
  mockRevokeSession: vi.fn(),
  mockRevokeOtherSessions: vi.fn(),
}));

vi.mock('@/api/user', () => ({ getAuthSessions: mockGetAuthSessions }));
vi.mock('@/lib/auth-client', () => ({
  getSession: mockGetSession,
  authClient: { revokeSession: mockRevokeSession, revokeOtherSessions: mockRevokeOtherSessions },
}));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification: vi.fn(), addSuccessNotification: vi.fn() }),
}));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      settings: {
        security: {
          activeSessions: {
            noSessions: 'No active sessions found',
            loadError: 'Could not load your sessions',
          },
        },
      },
      common: { actions: { retry: 'Try again' } },
    },
  },
});

const buildSession = ({ token, userAgent = 'Chrome/120' }: { token: string; userAgent?: string }) => ({
  id: `${token}-id`,
  userId: 'user-1',
  token,
  ipAddress: '127.0.0.1',
  userAgent,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-17T10:00:00.000Z',
  expiresAt: '2026-10-25T10:00:00.000Z',
});

const mountComponent = async () => {
  const wrapper = mount(ActiveSessions, { global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
};

describe('active sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetSession.mockResolvedValue({ data: { session: { token: 'current-token' } } });
  });

  it('lists the sessions the API returns', async () => {
    mockGetAuthSessions.mockResolvedValue([buildSession({ token: 'current-token' }), buildSession({ token: 'other' })]);

    const wrapper = await mountComponent();

    expect(wrapper.findAll('[data-testid="session-item"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="sessions-load-error"]').exists()).toBe(false);
  });

  it('puts the current session first and offers revoke only on the others', async () => {
    mockGetAuthSessions.mockResolvedValue([buildSession({ token: 'other' }), buildSession({ token: 'current-token' })]);

    const wrapper = await mountComponent();
    const [first, second] = wrapper.findAll('[data-testid="session-item"]');

    expect(first!.text()).toContain('currentBadge');
    expect(first!.find('button').exists()).toBe(false);
    expect(second!.text()).not.toContain('currentBadge');
    expect(second!.find('button').exists()).toBe(true);
  });

  it('shows the error state when the current session cannot be resolved', async () => {
    mockGetSession.mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockGetAuthSessions.mockResolvedValue([buildSession({ token: 'current-token' })]);

    const wrapper = await mountComponent();

    expect(wrapper.find('[data-testid="sessions-load-error"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="session-item"]')).toHaveLength(0);
  });

  it('shows the empty message only when the API returns no sessions', async () => {
    mockGetAuthSessions.mockResolvedValue([]);

    const wrapper = await mountComponent();

    expect(wrapper.text()).toContain('No active sessions found');
    expect(wrapper.find('[data-testid="sessions-load-error"]').exists()).toBe(false);
  });

  it('shows an error state instead of the empty message when loading fails', async () => {
    mockGetAuthSessions.mockRejectedValue(new Error('boom'));

    const wrapper = await mountComponent();

    expect(wrapper.find('[data-testid="sessions-load-error"]').text()).toContain('Could not load your sessions');
    expect(wrapper.text()).not.toContain('No active sessions found');
  });

  it('loads the sessions again when retry is clicked', async () => {
    mockGetAuthSessions.mockRejectedValueOnce(new Error('boom'));
    mockGetAuthSessions.mockResolvedValueOnce([buildSession({ token: 'current-token' })]);

    const wrapper = await mountComponent();
    await wrapper.find('[data-testid="sessions-retry"]').trigger('click');
    await flushPromises();

    expect(mockGetAuthSessions).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="sessions-load-error"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="session-item"]')).toHaveLength(1);
  });
});
