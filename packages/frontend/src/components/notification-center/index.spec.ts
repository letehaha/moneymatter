import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type ToastT, toast } from 'vue-sonner';

import { NotificationType, dismissPersistentNotifications, useNotificationCenter } from './index';
import { pulseToast } from './toast-pulse';
import { releaseToastTimers } from './toast-timers';

vi.mock('vue-sonner', () => {
  const raise = () => vi.fn((_text: string, options: { id: string | number }) => options.id);

  return {
    toast: {
      success: raise(),
      error: raise(),
      warning: raise(),
      info: raise(),
      dismiss: vi.fn(),
    },
  };
});

// Detection runs against the real DOM; only the animation trigger is observed.
vi.mock('./toast-pulse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./toast-pulse')>()),
  pulseToast: vi.fn(),
}));

const DEFAULT_VISIBILITY_TIME = 4000;

const mockedToast = vi.mocked(toast);
const mockedPulseToast = vi.mocked(pulseToast);
const RAISE_MOCKS = [mockedToast.success, mockedToast.error, mockedToast.warning, mockedToast.info];

const mountToast = ({ id, removed }: { id: string; removed?: boolean }) => {
  const element = document.createElement('li');
  element.setAttribute('data-sonner-toast', '');
  element.setAttribute('data-testid', id);
  element.setAttribute('data-removed', String(Boolean(removed)));
  document.body.append(element);

  return element;
};

const lastRaisedOptions = ({ raiseToast }: { raiseToast: (typeof RAISE_MOCKS)[number] }) =>
  raiseToast.mock.calls.at(-1)?.[1];

const raisedSonnerIds = ({ raiseToast }: { raiseToast: (typeof RAISE_MOCKS)[number] }) =>
  raiseToast.mock.calls.map(([, options]) => options?.id);

const lastSonnerId = ({ raiseToast }: { raiseToast: (typeof RAISE_MOCKS)[number] }) =>
  lastRaisedOptions({ raiseToast })?.id;

const dismissLastRaise = ({ raiseToast }: { raiseToast: (typeof RAISE_MOCKS)[number] }) =>
  lastRaisedOptions({ raiseToast })?.onDismiss?.({} as ToastT);

const { addNotification, addSuccessNotification, addErrorNotification, addInfoNotification, removeNotification } =
  useNotificationCenter();

beforeEach(() => {
  vi.useFakeTimers();
});

// The timer registry and the active-id map are module state that outlives a test, so every raised
// toast is walked through the dismissal that clears both.
afterEach(() => {
  RAISE_MOCKS.forEach((raiseToast) =>
    raiseToast.mock.calls.forEach(([, options]) => options?.onDismiss?.({} as ToastT)),
  );
  releaseToastTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('notification center timers', () => {
  test('hands sonner an infinite duration and the deduped id', () => {
    const id = addNotification({ text: 'Saved', description: 'All good', type: NotificationType.success });

    expect(id).toBe(`${NotificationType.success}:Saved:All good`);
    expect(lastRaisedOptions({ raiseToast: mockedToast.success })).toMatchObject({
      testId: String(id),
      duration: Infinity,
    });
  });

  test('auto-dismisses a plain notification after the default visibility time', () => {
    addInfoNotification('Rates updated');
    const sonnerId = lastSonnerId({ raiseToast: mockedToast.info });

    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME - 1);
    expect(mockedToast.dismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockedToast.dismiss).toHaveBeenCalledExactlyOnceWith(sonnerId);
  });

  test('honours an explicit visibilityTime', () => {
    addNotification({ text: 'Import failed', visibilityTime: 10_000 });

    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME);
    expect(mockedToast.dismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(6000);
    expect(mockedToast.dismiss).toHaveBeenCalledTimes(1);
  });

  test('never auto-dismisses a persistent notification', () => {
    addNotification({ text: 'Reconnect your bank account', persistent: true });

    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME * 100);
    expect(mockedToast.dismiss).not.toHaveBeenCalled();
  });

  test('re-raising the same notification as persistent stops the pending dismissal', () => {
    addNotification({ text: 'Sync failed' });
    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME - 500);

    addNotification({ text: 'Sync failed', persistent: true });
    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME * 100);
    expect(mockedToast.dismiss).not.toHaveBeenCalled();
  });

  test('a deduped re-raise restarts the countdown from full', () => {
    addSuccessNotification('Transaction created');
    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME - 500);

    addSuccessNotification('Transaction created');
    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME - 1);
    expect(mockedToast.dismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockedToast.dismiss).toHaveBeenCalledTimes(1);
  });

  test('a dismissal cancels the pending timer through onDismiss', () => {
    addErrorNotification('Import failed');

    dismissLastRaise({ raiseToast: mockedToast.error });

    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME * 100);
    expect(mockedToast.dismiss).not.toHaveBeenCalled();
  });
});

describe('notification center sonner ids', () => {
  test('hands sonner a minted id and keeps the notification id as testId', () => {
    addSuccessNotification('Transaction created');

    const options = lastRaisedOptions({ raiseToast: mockedToast.success });
    expect(options?.testId).toBe(`${NotificationType.success}:Transaction created:`);
    expect(options?.id).not.toBe(options?.testId);
  });

  test('raises a same-tick double notification under a single sonner id', () => {
    addSuccessNotification('Transaction created');
    addSuccessNotification('Transaction created');

    const [first, second] = raisedSonnerIds({ raiseToast: mockedToast.success });
    expect(mockedToast.success).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
  });

  test('mints a fresh sonner id for a raise that follows a timed-out dismissal', () => {
    const id = addNotification({ text: 'Sync failed', type: NotificationType.error });
    const dismissedId = lastSonnerId({ raiseToast: mockedToast.error });

    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME);
    expect(mockedToast.dismiss).toHaveBeenCalledExactlyOnceWith(dismissedId);

    addErrorNotification('Sync failed');

    const options = lastRaisedOptions({ raiseToast: mockedToast.error });
    expect(options?.id).not.toBe(dismissedId);
    expect(options?.testId).toBe(String(id));
  });

  test('mints a fresh sonner id for a raise that follows onDismiss', () => {
    const id = addNotification({ text: 'Sync failed', type: NotificationType.error });
    const dismissedId = lastSonnerId({ raiseToast: mockedToast.error });

    dismissLastRaise({ raiseToast: mockedToast.error });
    addErrorNotification('Sync failed');

    const options = lastRaisedOptions({ raiseToast: mockedToast.error });
    expect(options?.id).not.toBe(dismissedId);
    expect(options?.testId).toBe(String(id));
  });

  test('keeps the live sonner id for a persistent re-raise and leaves it untimed', () => {
    addNotification({ text: 'Reconnect your bank account', persistent: true });
    const sonnerId = lastSonnerId({ raiseToast: mockedToast.info });

    addNotification({ text: 'Reconnect your bank account', persistent: true });

    expect(lastSonnerId({ raiseToast: mockedToast.info })).toBe(sonnerId);
    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME * 100);
    expect(mockedToast.dismiss).not.toHaveBeenCalled();
  });

  test('falls back to the derived id when the caller passes a falsy one', () => {
    const id = addNotification({ id: 0, text: 'Rates updated' });

    expect(id).toBe(`${NotificationType.info}:Rates updated:`);
    expect(lastRaisedOptions({ raiseToast: mockedToast.info })?.testId).toBe(String(id));
  });
});

describe('notification center action icon', () => {
  test('styles the action button by its icon', () => {
    addNotification({
      text: 'Moved',
      type: NotificationType.success,
      action: { label: 'Undo', icon: 'undo', onClick: () => {} },
    });

    expect(lastRaisedOptions({ raiseToast: mockedToast.success })?.classes).toEqual({
      actionButton: 'toast-action-icon-undo',
    });
  });

  test('leaves the action button unstyled without an icon', () => {
    addNotification({ text: 'Moved', type: NotificationType.success, action: { label: 'Undo', onClick: () => {} } });

    expect(lastRaisedOptions({ raiseToast: mockedToast.success })?.classes).toBeUndefined();
  });
});

describe('notification center explicit-id dedup', () => {
  const raisePlanRequired = () =>
    addNotification({
      id: 'plan-required-error',
      text: 'Upgrade to continue',
      type: NotificationType.error,
      action: { label: 'See plans', onClick: () => {} },
      persistent: true,
    });

  test('folds a plain raise into the live toast an explicit id holds the same text under', () => {
    const id = raisePlanRequired();
    const element = mountToast({ id: String(id) });

    addErrorNotification('Upgrade to continue');

    expect(mockedToast.error).toHaveBeenCalledTimes(1);
    expect(mockedPulseToast).toHaveBeenCalledExactlyOnceWith({ element });
    expect(lastRaisedOptions({ raiseToast: mockedToast.error })?.action).toMatchObject({ label: 'See plans' });
    expect(addNotification({ text: 'Upgrade to continue', type: NotificationType.error })).toBe(id);
  });

  test('mints a second toast for a different text', () => {
    raisePlanRequired();
    mountToast({ id: 'plan-required-error' });

    addErrorNotification('Import failed');

    expect(mockedToast.error).toHaveBeenCalledTimes(2);
    expect(mockedPulseToast).not.toHaveBeenCalled();
  });
});

describe('notification center removal', () => {
  test('dismisses the sonner toast currently raised under the id', () => {
    const id = addNotification({ text: 'Uploading' });
    const sonnerId = lastSonnerId({ raiseToast: mockedToast.info });

    removeNotification(id);

    expect(mockedToast.dismiss).toHaveBeenCalledExactlyOnceWith(sonnerId);

    vi.advanceTimersByTime(DEFAULT_VISIBILITY_TIME * 10);
    expect(mockedToast.dismiss).toHaveBeenCalledTimes(1);
  });

  test('mints a fresh sonner id for a raise that follows a removal', () => {
    const id = addNotification({ text: 'Uploading' });
    const removedId = lastSonnerId({ raiseToast: mockedToast.info });

    removeNotification(id);
    addInfoNotification('Uploading');

    expect(lastSonnerId({ raiseToast: mockedToast.info })).not.toBe(removedId);
  });

  test('dismisses an unknown id as given', () => {
    removeNotification('some-id');

    expect(mockedToast.dismiss).toHaveBeenCalledExactlyOnceWith('some-id');
  });

  test('ignores a falsy id, which sonner would read as dismiss-everything', () => {
    removeNotification(undefined);
    removeNotification(0);
    removeNotification('');

    expect(mockedToast.dismiss).not.toHaveBeenCalled();
  });
});

describe('notification center re-raise pulse', () => {
  test('pulses the toast a re-raise replaces on screen', () => {
    addSuccessNotification('Transaction created');
    const element = mountToast({ id: `${NotificationType.success}:Transaction created:` });

    addSuccessNotification('Transaction created');

    expect(mockedPulseToast).toHaveBeenCalledExactlyOnceWith({ element });
  });

  test('pulses a persistent toast, which no timer tracks', () => {
    addNotification({ text: 'Reconnect your bank account', type: NotificationType.error, persistent: true });
    const element = mountToast({ id: `${NotificationType.error}:Reconnect your bank account:` });

    addNotification({ text: 'Reconnect your bank account', type: NotificationType.error, persistent: true });

    expect(mockedPulseToast).toHaveBeenCalledExactlyOnceWith({ element });
  });

  test('leaves a first raise unpulsed', () => {
    addSuccessNotification('Transaction created');

    expect(mockedPulseToast).not.toHaveBeenCalled();
  });

  test('leaves a raise unpulsed while the toast holding its id is leaving', () => {
    addSuccessNotification('Transaction created');
    const sonnerId = lastSonnerId({ raiseToast: mockedToast.success });
    mountToast({ id: `${NotificationType.success}:Transaction created:`, removed: true });

    addSuccessNotification('Transaction created');

    expect(mockedPulseToast).not.toHaveBeenCalled();
    expect(lastSonnerId({ raiseToast: mockedToast.success })).toBe(sonnerId);
  });

  test('raises a new unpulsed toast when the dismissed one is still animating out', () => {
    const id = addNotification({ text: 'Transaction created', type: NotificationType.success });
    const dismissedId = lastSonnerId({ raiseToast: mockedToast.success });
    dismissLastRaise({ raiseToast: mockedToast.success });
    mountToast({ id: String(id), removed: true });

    addSuccessNotification('Transaction created');

    expect(mockedPulseToast).not.toHaveBeenCalled();
    expect(mockedToast.success).toHaveBeenCalledTimes(2);
    const options = lastRaisedOptions({ raiseToast: mockedToast.success });
    expect(options?.id).not.toBe(dismissedId);
    expect(options?.testId).toBe(String(id));
  });

  test('does not pulse a different notification', () => {
    addErrorNotification('Import failed');
    mountToast({ id: `${NotificationType.success}:Transaction created:` });

    addErrorNotification('Import failed');

    expect(mockedPulseToast).not.toHaveBeenCalled();
  });
});

describe('notification center persistent dismissal', () => {
  test('dismisses only the persistent toasts and releases their ids', () => {
    addNotification({ text: 'Upgrade to continue', type: NotificationType.error, persistent: true });
    const persistentSonnerId = lastSonnerId({ raiseToast: mockedToast.error });
    addSuccessNotification('Transaction created');

    dismissPersistentNotifications();

    expect(mockedToast.dismiss).toHaveBeenCalledExactlyOnceWith(persistentSonnerId);

    addNotification({ text: 'Upgrade to continue', type: NotificationType.error, persistent: true });
    expect(lastSonnerId({ raiseToast: mockedToast.error })).not.toBe(persistentSonnerId);
  });
});
