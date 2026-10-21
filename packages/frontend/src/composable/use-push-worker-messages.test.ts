import { ROUTES_NAMES } from '@/routes/constants';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { usePushWorkerMessages } from './use-push-worker-messages';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  openNotificationById: vi.fn(),
  handleEndpointChanged: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/composable/use-open-notification', () => ({
  useOpenNotification: () => ({ openNotificationById: mocks.openNotificationById }),
}));
vi.mock('@/composable/use-web-push', () => ({
  useWebPush: () => ({ handleEndpointChanged: mocks.handleEndpointChanged }),
}));

const setup = () => {
  let handleMessage!: ReturnType<typeof usePushWorkerMessages>['handleMessage'];

  mount(
    defineComponent({
      setup() {
        ({ handleMessage } = usePushWorkerMessages());
        return () => null;
      },
    }),
  );

  return handleMessage;
};

const buildEvent = ({ data }: { data: unknown }) => {
  const port = { postMessage: vi.fn() };

  return { event: { data, ports: [port] } as unknown as MessageEvent, port };
};

describe('usePushWorkerMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acknowledges a click on the port and opens the notification in place', () => {
    const handleMessage = setup();
    const { event, port } = buildEvent({
      data: { type: 'notification-click', notificationId: 'n-1', path: '/notifications/n-1' },
    });

    handleMessage(event);

    expect(port.postMessage).toHaveBeenCalledOnce();
    expect(mocks.openNotificationById).toHaveBeenCalledWith({ id: 'n-1' });
  });

  it('routes a click without a notification id (the test push) to its path', () => {
    const handleMessage = setup();
    const { event, port } = buildEvent({
      data: { type: 'notification-click', notificationId: null, path: '/settings/notifications' },
    });

    handleMessage(event);

    expect(port.postMessage).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith('/settings/notifications');
    expect(mocks.openNotificationById).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example/', '//evil.example/', undefined])(
    'sends a click with path %s to the dashboard',
    (path) => {
      const handleMessage = setup();
      const { event } = buildEvent({ data: { type: 'notification-click', notificationId: null, path } });

      handleMessage(event);

      expect(mocks.push).toHaveBeenCalledWith({ name: ROUTES_NAMES.home });
    },
  );

  it('hands a rotated endpoint to useWebPush', () => {
    const handleMessage = setup();
    const { event, port } = buildEvent({
      data: { type: 'push-endpoint-changed', endpoint: 'https://push.example/e2' },
    });

    handleMessage(event);

    expect(mocks.handleEndpointChanged).toHaveBeenCalledWith({ endpoint: 'https://push.example/e2' });
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it.each([null, 'text', { type: 'something-else' }])('ignores %j', (data) => {
    const handleMessage = setup();
    const { event, port } = buildEvent({ data });

    handleMessage(event);

    expect(port.postMessage).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.openNotificationById).not.toHaveBeenCalled();
    expect(mocks.handleEndpointChanged).not.toHaveBeenCalled();
  });

  it('listens on the service worker container while mounted', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { addEventListener, removeEventListener },
    });

    const wrapper = mount(
      defineComponent({
        setup() {
          usePushWorkerMessages();
          return () => null;
        },
      }),
    );

    expect(addEventListener).toHaveBeenCalledWith('message', expect.any(Function));

    wrapper.unmount();

    expect(removeEventListener).toHaveBeenCalledWith('message', addEventListener.mock.calls[0]![1]);
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
});
