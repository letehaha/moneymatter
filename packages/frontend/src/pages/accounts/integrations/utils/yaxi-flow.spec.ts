import type { OBResponse, Result } from 'routex-client';
import { describe, expect, it, vi } from 'vitest';

import {
  type YaxiAskStep,
  type YaxiPollingStep,
  YaxiCanceledError,
  YaxiTimeoutError,
  buildYaxiCredentials,
  bytesToBase64,
  canSubmitYaxiLogin,
  driveYaxiLogin,
  getYaxiErrorMessage,
  isValidYaxiSecret,
  resolveYaxiLoginForm,
} from './yaxi-flow';

const context = new Uint8Array([1]);
const result = { jwt: 'jwt', connectionData: new Uint8Array([2]) } as unknown as Result;
const response = (value: unknown) => value as OBResponse;

const setup = ({
  start,
  confirms = [],
  responds = [],
  answers = {},
  signal = new AbortController().signal,
  now,
}: {
  start: unknown;
  confirms?: unknown[];
  responds?: unknown[];
  answers?: Partial<Record<YaxiAskStep['kind'], string>>;
  signal?: AbortSignal;
  now?: () => number;
}) => {
  const asked: YaxiAskStep[] = [];
  const polled: YaxiPollingStep[] = [];
  const client = {
    confirmAccounts: vi.fn(async () => response(confirms.shift())),
    respondAccounts: vi.fn(async () => response(responds.shift())),
    registerRedirectUri: vi.fn(async () => new URL('https://bank.test/login')),
  };
  const wait = vi.fn(async () => {});
  const ask = vi.fn(async (step: YaxiAskStep) => {
    asked.push(step);
    return answers[step.kind] ?? '';
  });
  const run = () =>
    driveYaxiLogin({
      start: Promise.resolve(response(start)),
      client,
      ticket: 'ticket',
      redirectUri: 'https://app.test/done',
      ask,
      onPolling: (step) => polled.push(step),
      signal,
      wait,
      ...(now ? { now } : {}),
    });
  return { asked, polled, ask, client, wait, run };
};

const never = () => new Promise<never>(() => {});
const flushTasks = () => new Promise((resolve) => setTimeout(resolve));

const abortWhilePending = async ({
  start,
  arrange,
}: {
  start: unknown;
  arrange: (mocks: ReturnType<typeof setup>) => void;
}) => {
  const controller = new AbortController();
  const mocks = setup({ start, signal: controller.signal });
  arrange(mocks);
  const running = mocks.run();
  await flushTasks();
  controller.abort();
  await expect(running).rejects.toBeInstanceOf(YaxiCanceledError);
  return mocks;
};

describe('resolveYaxiLoginForm', () => {
  it.each([
    [
      { full: true, userId: false, none: false },
      { userId: 'required', password: true },
    ],
    [
      { full: true, userId: true, none: false },
      { userId: 'required', password: true },
    ],
    [
      { full: false, userId: true, none: false },
      { userId: 'required', password: false },
    ],
    [
      { full: false, userId: false, none: true },
      { userId: 'hidden', password: false },
    ],
    [
      { full: true, userId: false, none: true },
      { userId: 'hidden', password: false },
    ],
    [
      { full: true, userId: true, none: true },
      { userId: 'hidden', password: false },
    ],
    [
      { full: false, userId: true, none: true },
      { userId: 'optional', password: false },
    ],
  ])('%o resolves to %o', (credentials, expected) => {
    expect(resolveYaxiLoginForm({ credentials })).toEqual(expected);
  });
});

describe('login form helpers', () => {
  it('sends only what the form asked for', () => {
    expect(
      buildYaxiCredentials({
        connectionId: 'c',
        form: { userId: 'hidden', password: false },
        userId: 'stale',
        password: 'stale',
      }),
    ).toEqual({ connectionId: 'c' });
    expect(
      buildYaxiCredentials({
        connectionId: 'c',
        form: { userId: 'required', password: true },
        userId: ' me ',
        password: ' p ',
      }),
    ).toEqual({ connectionId: 'c', userId: 'me', password: ' p ' });
  });

  it.each(['', '   '])('omits an empty optional user ID (%j)', (userId) => {
    const form = { userId: 'optional', password: false } as const;
    expect(buildYaxiCredentials({ connectionId: 'c', form, userId, password: '' })).toStrictEqual({
      connectionId: 'c',
    });
  });

  it('trims an optional user ID', () => {
    const form = { userId: 'optional', password: false } as const;
    expect(buildYaxiCredentials({ connectionId: 'c', form, userId: ' me ', password: '' })).toStrictEqual({
      connectionId: 'c',
      userId: 'me',
    });
  });

  it('has no password key when the form has no password', () => {
    const form = { userId: 'required', password: false } as const;
    expect(buildYaxiCredentials({ connectionId: 'c', form, userId: 'me', password: 'stale' })).toStrictEqual({
      connectionId: 'c',
      userId: 'me',
    });
  });

  it('allows an empty optional user ID but not a required one', () => {
    expect(canSubmitYaxiLogin({ form: { userId: 'optional', password: false }, userId: '', password: '' })).toBe(true);
    expect(canSubmitYaxiLogin({ form: { userId: 'required', password: false }, userId: ' ', password: '' })).toBe(
      false,
    );
    expect(canSubmitYaxiLogin({ form: { userId: 'required', password: true }, userId: 'me', password: '' })).toBe(
      false,
    );
  });

  it('validates standard base64 secrets', () => {
    expect(isValidYaxiSecret({ secret: 'pb4M+a/C1w==' })).toBe(true);
    expect(isValidYaxiSecret({ secret: 'abc' })).toBe(false);
    expect(isValidYaxiSecret({ secret: 'ab-_' })).toBe(false);
    expect(isValidYaxiSecret({ secret: '' })).toBe(false);
  });

  it('encodes bytes as standard base64', () => {
    expect(bytesToBase64({ bytes: new Uint8Array([251, 255, 0]) })).toBe('+/8A');
  });
});

describe('driveYaxiLogin', () => {
  it('returns an immediate result without asking anything', async () => {
    const { asked, run } = setup({ start: result });
    await expect(run()).resolves.toBe(result);
    expect(asked).toEqual([]);
  });

  it('asks for a click on a confirmation without a polling delay', async () => {
    const { asked, client, wait, run } = setup({
      start: { input: { context }, message: 'Confirm in your app' },
      confirms: [result],
    });
    await run();
    expect(asked[0]).toMatchObject({ kind: 'confirmation', message: 'Confirm in your app' });
    expect(wait).not.toHaveBeenCalled();
    expect(client.confirmAccounts).toHaveBeenCalledWith({ ticket: 'ticket', context });
  });

  it('auto-confirms after the polling delay without asking', async () => {
    const { asked, wait, run } = setup({ start: { input: { context, pollingDelaySecs: 3 } }, confirms: [result] });
    await run();
    expect(asked).toEqual([]);
    expect(wait).toHaveBeenCalledWith({ ms: 3000 });
  });

  it('answers a selection and a field with the same ticket', async () => {
    const { asked, client, run } = setup({
      start: { input: { context, options: [{ key: 'tan', label: 'TAN' }] } },
      responds: [{ input: { context, secrecyLevel: 'OTP' } }, result],
      answers: { selection: 'tan', field: '123456' },
    });
    await run();
    expect(asked.map((step) => step.kind)).toEqual(['selection', 'field']);
    expect(asked[1]).toMatchObject({ masked: true });
    expect(client.respondAccounts).toHaveBeenNthCalledWith(1, { ticket: 'ticket', context, response: 'tan' });
    expect(client.respondAccounts).toHaveBeenNthCalledWith(2, { ticket: 'ticket', context, response: '123456' });
  });

  it('leaves a plain field unmasked and exposes the dialog image', async () => {
    const { asked, run } = setup({
      start: {
        input: { context, secrecyLevel: 'PLAIN' },
        image: { mimeType: 'image/png', data: new Uint8Array([255]) },
      },
      responds: [result],
    });
    await run();
    expect(asked[0]).toMatchObject({ masked: false, imageUrl: 'data:image/png;base64,/w==' });
  });

  it('registers the redirect URI for a handle, then polls after the user opens the bank', async () => {
    const { asked, client, run } = setup({
      start: { handle: 'h', context },
      confirms: [{ input: { context, pollingDelaySecs: 1 } }, result],
    });
    await run();
    expect(client.registerRedirectUri).toHaveBeenCalledWith({
      ticket: 'ticket',
      handle: 'h',
      redirectUri: 'https://app.test/done',
    });
    expect(asked).toEqual([{ kind: 'redirect', url: 'https://bank.test/login' }]);
    expect(client.confirmAccounts).toHaveBeenCalledTimes(2);
  });

  it('uses the URL of a ready redirect as is', async () => {
    const { asked, client, run } = setup({
      start: { url: new URL('https://bank.test/direct'), context },
      confirms: [result],
    });
    await run();
    expect(client.registerRedirectUri).not.toHaveBeenCalled();
    expect(asked).toEqual([{ kind: 'redirect', url: 'https://bank.test/direct' }]);
  });

  it('stops polling after five minutes', async () => {
    let time = 0;
    const polling = { input: { context, pollingDelaySecs: 1 } };
    const now = () => (time += 3 * 60 * 1000);
    const { run } = setup({ start: polling, confirms: [polling, polling, polling], now });
    await expect(run()).rejects.toBeInstanceOf(YaxiTimeoutError);
  });

  it('restarts the polling deadline after the user answers', async () => {
    let time = 0;
    const polling = { input: { context, pollingDelaySecs: 1 } };
    const now = () => (time += 3 * 60 * 1000);
    const { run } = setup({
      start: polling,
      confirms: [{ input: { context } }, polling, result],
      now,
    });
    await expect(run()).resolves.toBe(result);
  });

  it('rejects as canceled once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { run } = setup({ start: result, signal: controller.signal });
    await expect(run()).rejects.toBeInstanceOf(YaxiCanceledError);
  });

  it('rejects as canceled when aborted while the user is asked', async () => {
    const { ask } = await abortWhilePending({
      start: { input: { context } },
      arrange: (mocks) => mocks.ask.mockImplementationOnce(never),
    });
    expect(ask).toHaveBeenCalledOnce();
  });

  it('rejects as canceled when aborted during the polling wait', async () => {
    const { wait } = await abortWhilePending({
      start: { input: { context, pollingDelaySecs: 1 } },
      arrange: (mocks) => mocks.wait.mockImplementationOnce(never),
    });
    expect(wait).toHaveBeenCalledOnce();
  });

  it('rejects as canceled when aborted while confirmAccounts is in flight', async () => {
    const { client } = await abortWhilePending({
      start: { input: { context } },
      arrange: (mocks) => mocks.client.confirmAccounts.mockImplementationOnce(never),
    });
    expect(client.confirmAccounts).toHaveBeenCalledOnce();
  });

  it('leaves no unhandled rejection when a promise rejects after the abort', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const controller = new AbortController();
    controller.abort();
    let rejectStart!: (reason: Error) => void;
    const start = new Promise((_, reject) => {
      rejectStart = reject;
    });

    await expect(setup({ start, signal: controller.signal }).run()).rejects.toBeInstanceOf(YaxiCanceledError);
    rejectStart(new Error('late'));
    await flushTasks();

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('reports the redirect URL while polling after a redirect', async () => {
    const { polled, run } = setup({ start: { url: new URL('https://bank.test/direct'), context }, confirms: [result] });
    await run();
    expect(polled).toEqual([{ kind: 'polling', redirectUrl: 'https://bank.test/direct' }]);
  });

  it('reports plain polling after selection and field answers', async () => {
    const { polled, run } = setup({
      start: { input: { context, options: [] } },
      responds: [{ input: { context, secrecyLevel: 'OTP' } }, result],
    });
    await run();
    expect(polled).toEqual([{ kind: 'polling' }, { kind: 'polling' }]);
  });

  it('forwards the message and image of a delayed confirmation', async () => {
    const { polled, run } = setup({
      start: {
        input: { context, pollingDelaySecs: 1 },
        message: 'Approve',
        image: { mimeType: 'image/png', data: new Uint8Array([255]) },
      },
      confirms: [result],
    });
    await run();
    expect(polled).toEqual([{ kind: 'polling', message: 'Approve', imageUrl: 'data:image/png;base64,/w==' }]);
  });

  it.each([
    ['redirect', { url: new URL('https://bank.test/direct') }],
    ['redirect handle', { handle: 'h' }],
  ])('confirms with the context of the %s response', async (_, redirect) => {
    const redirectContext = new Uint8Array([9]);
    const { client, run } = setup({ start: { ...redirect, context: redirectContext }, confirms: [result] });
    await run();
    expect(client.confirmAccounts).toHaveBeenCalledWith({ ticket: 'ticket', context: redirectContext });
  });

  it('polls on a zero delay', async () => {
    const { asked, wait, run } = setup({ start: { input: { context, pollingDelaySecs: 0 } }, confirms: [result] });
    await run();
    expect(asked).toEqual([]);
    expect(wait).toHaveBeenCalledWith({ ms: 0 });
  });

  it('asks on a null delay', async () => {
    const { asked, wait, run } = setup({ start: { input: { context, pollingDelaySecs: null } }, confirms: [result] });
    await run();
    expect(asked[0]).toMatchObject({ kind: 'confirmation' });
    expect(wait).not.toHaveBeenCalled();
  });

  it.each([
    ['selection', { input: { context, options: [] } }],
    ['field', { input: { context, secrecyLevel: 'OTP' } }],
  ])('restarts the polling deadline after a %s answer', async (_, dialog) => {
    let time = 0;
    const polling = { input: { context, pollingDelaySecs: 1 } };
    const now = () => (time += 3 * 60 * 1000);
    const { run } = setup({ start: polling, confirms: [dialog, result], responds: [polling], now });
    await expect(run()).resolves.toBe(result);
  });

  it('throws on an unknown response', async () => {
    await expect(setup({ start: {} }).run()).rejects.toThrow('Unknown YAXI response');
  });
});

describe('getYaxiErrorMessage', () => {
  const t = (key: string) => key;
  const message = (error: unknown) => getYaxiErrorMessage({ error, t, fallbackKey: 'fallback' });

  it('prefers the message written for the user', () => {
    expect(message({ name: 'InvalidCredentialsException', userMessage: 'PIN locked' })).toBe('PIN locked');
  });

  it('maps known exceptions', () => {
    expect(message({ name: 'InvalidCredentialsException' })).toBe('pages.integrations.yaxi.errors.invalidCredentials');
    expect(message({ name: 'TicketException', code: 'EXPIRED_KEY' })).toBe('pages.integrations.yaxi.errors.expiredKey');
    expect(message({ name: 'TicketException', code: 'KEY_ENVIRONMENT_MISMATCH' })).toBe(
      'pages.integrations.yaxi.errors.keyEnvironmentMismatch',
    );
    expect(message(new YaxiTimeoutError())).toBe('pages.integrations.yaxi.errors.pollingTimeout');
    expect(message({ name: 'CanceledException' })).toBe('pages.integrations.yaxi.errors.canceledByBank');
  });

  it.each([[undefined], [null], ['plain string'], [{ name: 'TicketException', code: 'UNKNOWN' }]])(
    'falls back for %j',
    (error) => {
      expect(message(error)).toBe('fallback');
    },
  );

  it('uses the backend message, then the fallback, never the raw library text', () => {
    expect(message({ data: { message: 'From API' } })).toBe('From API');
    expect(message(new Error('internal detail'))).toBe('fallback');
  });
});
