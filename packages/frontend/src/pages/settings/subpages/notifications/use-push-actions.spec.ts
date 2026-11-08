import { usePushActions } from './use-push-actions';

const { mockEnable, mockDisable, mockSuccess, mockError, mockInfo } = vi.hoisted(() => ({
  mockEnable: vi.fn(),
  mockDisable: vi.fn(),
  mockSuccess: vi.fn(),
  mockError: vi.fn(),
  mockInfo: vi.fn(),
}));

vi.mock('@/composable/use-web-push', () => ({
  useWebPush: () => ({ enable: mockEnable, disable: mockDisable }),
}));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({
    addSuccessNotification: mockSuccess,
    addErrorNotification: mockError,
    addInfoNotification: mockInfo,
  }),
}));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const PREFIX = 'settings.notifications.thisDevice.toasts';

describe('usePushActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms a successful enable with a success toast', async () => {
    mockEnable.mockResolvedValue('enabled');

    await usePushActions().turnOn();

    expect(mockSuccess).toHaveBeenCalledWith(`${PREFIX}.enabled`);
    expect(mockError).not.toHaveBeenCalled();
  });

  it.each([
    ['denied', mockError, 'denied'],
    ['failed', mockError, 'failed'],
    ['dismissed', mockInfo, 'dismissed'],
    ['tap-again', mockInfo, 'tapAgain'],
  ])('answers an enable result of %s with its own toast', async (result, toast, key) => {
    mockEnable.mockResolvedValue(result);

    await usePushActions().turnOn();

    expect(toast).toHaveBeenCalledWith(`${PREFIX}.${key}`);
    expect(mockSuccess).not.toHaveBeenCalled();
  });

  it('confirms a disable with a success toast', async () => {
    mockDisable.mockResolvedValue(undefined);

    await usePushActions().turnOff();

    expect(mockSuccess).toHaveBeenCalledWith(`${PREFIX}.disabled`);
  });

  it('shows an error toast when the disable throws', async () => {
    mockDisable.mockRejectedValue(new Error('network'));

    await usePushActions().turnOff();

    expect(mockError).toHaveBeenCalledWith(`${PREFIX}.disableFailed`);
    expect(mockSuccess).not.toHaveBeenCalled();
  });
});
