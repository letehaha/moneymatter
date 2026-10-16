import { AI_PROVIDER, type CliAuthSessionInfo, type CliAuthSessionStatus } from '@bt/shared/types';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { startMock, getMock, submitMock, cancelMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  getMock: vi.fn(),
  submitMock: vi.fn(),
  cancelMock: vi.fn(),
}));

vi.mock('@/api/ai-settings', () => ({
  startCliAuthSession: startMock,
  getCliAuthSession: getMock,
  submitCliAuthCode: submitMock,
  cancelCliAuthSession: cancelMock,
}));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification: vi.fn() }),
}));

import CliSignInPanel from './cli-sign-in-panel.vue';

const AUTH_URL = 'https://auth.openai.com/codex/device';

const makeSession = (
  status: CliAuthSessionStatus,
  overrides: Partial<CliAuthSessionInfo> = {},
): CliAuthSessionInfo => ({
  id: 'session-1',
  provider: AI_PROVIDER.claudeCode,
  status,
  authUrl: AUTH_URL,
  expiresAt: '2026-10-17T12:15:00.000Z',
  ...overrides,
});

const mountPanel = ({
  provider = AI_PROVIDER.claudeCode,
  isReauth = false,
}: { provider?: AI_PROVIDER.claudeCode | AI_PROVIDER.codex; isReauth?: boolean } = {}) =>
  mount(CliSignInPanel, {
    props: { provider, signInLabel: 'Sign in with the vendor', isReauth },
    global: { mocks: { $t: (key: string) => key } },
  });

/** The value the panel last reported; the model's default (null) is not emitted. */
const lastSessionId = ({ wrapper }: { wrapper: ReturnType<typeof mountPanel> }) =>
  wrapper.emitted<[string | null]>('update:sessionId')?.at(-1)?.[0] ?? null;

const findButton = ({ wrapper, text }: { wrapper: ReturnType<typeof mountPanel>; text: string }) =>
  wrapper.findAll('button').find((button) => button.text().includes(text));

describe('CliSignInPanel', () => {
  beforeEach(() => {
    startMock.mockReset();
    getMock.mockReset().mockResolvedValue(makeSession('awaiting-user'));
    submitMock.mockReset();
    cancelMock.mockReset().mockResolvedValue(undefined);
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with the provider sign-in button', () => {
    const wrapper = mountPanel();

    expect(wrapper.text()).toContain('Sign in with the vendor');
    expect(lastSessionId({ wrapper })).toBeNull();
  });

  it('offers to sign in again on a connection that already holds a sign-in', () => {
    const wrapper = mountPanel({ isReauth: true });

    expect(wrapper.text()).toContain('settings.ai.connections.actions.signInAgain');
    expect(wrapper.text()).not.toContain('Sign in with the vendor');
  });

  it('asks Claude users for the code the sign-in page shows and sends it', async () => {
    startMock.mockResolvedValue(makeSession('awaiting-user'));
    submitMock.mockResolvedValue(makeSession('succeeded'));
    const wrapper = mountPanel();

    await findButton({ wrapper, text: 'Sign in with the vendor' })!.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('update:inProgress')?.at(-1)).toEqual([true]);
    const input = wrapper.find('input');
    expect(input.exists()).toBe(true);
    expect(
      findButton({ wrapper, text: 'settings.ai.connections.cli.submitCode' })!.attributes('disabled'),
    ).toBeDefined();

    await input.setValue('  abc-123  ');
    await findButton({ wrapper, text: 'settings.ai.connections.cli.submitCode' })!.trigger('click');
    await flushPromises();

    expect(submitMock).toHaveBeenCalledWith({ id: 'session-1', code: 'abc-123' });
    expect(lastSessionId({ wrapper })).toBe('session-1');
    expect(wrapper.emitted('update:inProgress')?.at(-1)).toEqual([false]);
  });

  it('shows Codex users the device code instead of a code field', async () => {
    startMock.mockResolvedValue(
      makeSession('awaiting-user', { provider: AI_PROVIDER.codex, userCode: 'ABCD-EFGH', authUrl: AUTH_URL }),
    );
    const wrapper = mountPanel({ provider: AI_PROVIDER.codex });

    await findButton({ wrapper, text: 'Sign in with the vendor' })!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('ABCD-EFGH');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find(`a[href="${AUTH_URL}"]`).exists()).toBe(true);
  });

  it('cancels a running sign-in on the server', async () => {
    startMock.mockResolvedValue(makeSession('awaiting-user'));
    const wrapper = mountPanel();

    await findButton({ wrapper, text: 'Sign in with the vendor' })!.trigger('click');
    await flushPromises();
    await findButton({ wrapper, text: 'settings.ai.connections.cli.cancel' })!.trigger('click');
    await flushPromises();

    expect(cancelMock).toHaveBeenCalledWith({ id: 'session-1' });
    expect(wrapper.text()).toContain('Sign in with the vendor');
    expect(wrapper.emitted('update:inProgress')?.at(-1)).toEqual([false]);
  });

  it('offers a retry after a failed sign-in and shows the reason', async () => {
    startMock.mockResolvedValue(makeSession('failed', { error: 'Login was cancelled' }));
    const wrapper = mountPanel();

    await findButton({ wrapper, text: 'Sign in with the vendor' })!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Login was cancelled');
    expect(findButton({ wrapper, text: 'settings.ai.connections.cli.retry' })).toBeDefined();
    expect(lastSessionId({ wrapper })).toBeNull();
  });
});
