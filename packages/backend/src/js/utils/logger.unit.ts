import { afterEach, describe, expect, it, jest } from '@jest/globals';

// Mock the Sentry wrapper `logger.ts` imports so tests never touch the real
// `@sentry/node` client and can assert on capture calls directly.
const captureException = jest.fn();
const captureMessage = jest.fn();
const withScope = jest.fn((callback: (scope: unknown) => void) => {
  callback({ setExtras: jest.fn(), setExtra: jest.fn(), setTag: jest.fn() });
});

jest.mock('./sentry', () => ({
  isSentryEnabled: () => true,
  Sentry: {
    withScope: (callback: (scope: unknown) => void) => withScope(callback),
    captureException: (error: unknown) => captureException(error),
    captureMessage: (message: string, level: string) => captureMessage(message, level),
  },
}));

// eslint-disable-next-line import/first
import { NotFoundError, UnexpectedError, ValidationError } from '@js/errors';

// eslint-disable-next-line import/first
import { createMessageRateLimiter, logger, lokiStringMetadataOnly } from './logger';

describe('lokiStringMetadataOnly', () => {
  it('keeps only string fields as metadata and leaves the formatted line intact', () => {
    const MESSAGE = Symbol.for('message');
    const info = lokiStringMetadataOnly().transform({
      level: 'info',
      message: 'sync done',
      requestId: null,
      sessionId: 'abc',
      count: 5,
      balances: [{ amount: '-1' }],
      [MESSAGE]: 'full line',
    }) as Record<string | symbol, unknown>;

    expect(Object.fromEntries(Object.entries(info))).toEqual({ level: 'info', message: 'sync done', sessionId: 'abc' });
    expect(info[MESSAGE]).toBe('full line');
  });
});

describe('logger.error Sentry capture', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does not capture a ValidationError (4xx CustomError)', () => {
    logger.error(new ValidationError({ message: 'x' }));

    expect(captureException).not.toHaveBeenCalled();
  });

  it('does not capture a NotFoundError (4xx CustomError)', () => {
    logger.error(new NotFoundError({ message: 'x' }));

    expect(captureException).not.toHaveBeenCalled();
  });

  it('captures an UnexpectedError (5xx CustomError)', () => {
    logger.error(new UnexpectedError({ message: 'boom' }));

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('captures a non-CustomError', () => {
    logger.error(new Error('raw'));

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('does not capture a 4xx CustomError passed via the { message, error } object form', () => {
    logger.error({ error: new ValidationError({ message: 'x' }), message: 'ctx' });

    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('createMessageRateLimiter', () => {
  const HOUR = 60 * 60 * 1000;

  it('allows `limit` calls per message per window, then refuses', () => {
    const allow = createMessageRateLimiter({ limit: 3, windowMs: HOUR, maxKeys: 10 });
    const results = Array.from({ length: 5 }, (_, i) => allow({ message: 'a', now: 1000 + i }));

    expect(results).toEqual([true, true, true, false, false]);
  });

  it('counts each distinct message separately', () => {
    const allow = createMessageRateLimiter({ limit: 1, windowMs: HOUR, maxKeys: 10 });

    expect(allow({ message: 'a', now: 1000 })).toBe(true);
    expect(allow({ message: 'a', now: 1001 })).toBe(false);
    expect(allow({ message: 'b', now: 1002 })).toBe(true);
  });

  it('allows the message again once the window rolls over', () => {
    const allow = createMessageRateLimiter({ limit: 1, windowMs: HOUR, maxKeys: 10 });

    expect(allow({ message: 'a', now: 1000 })).toBe(true);
    expect(allow({ message: 'a', now: 1000 + HOUR - 1 })).toBe(false);
    expect(allow({ message: 'a', now: 1000 + HOUR })).toBe(true);
  });

  it('refuses unseen messages once `maxKeys` are tracked, until the window rolls over', () => {
    const allow = createMessageRateLimiter({ limit: 5, windowMs: HOUR, maxKeys: 2 });

    expect(allow({ message: 'a', now: 1000 })).toBe(true);
    expect(allow({ message: 'b', now: 1000 })).toBe(true);
    expect(allow({ message: 'c', now: 1000 })).toBe(false);
    expect(allow({ message: 'a', now: 1000 })).toBe(true);
    expect(allow({ message: 'c', now: 1000 + HOUR })).toBe(true);
  });
});

describe('logger Sentry volume guard', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sends a repeated warn message to Sentry at most 20 times', () => {
    for (let i = 0; i < 30; i++) logger.warn('looping warn', { i });

    expect(captureMessage).toHaveBeenCalledTimes(20);
    expect(captureMessage).toHaveBeenCalledWith('looping warn', 'warning');
  });

  describe('daily total cap', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const CAP_MARKER = 'Sentry warn daily cap reached; further warns are dropped from Sentry';

    const warnsSent = () => captureMessage.mock.calls.filter(([message]) => message !== CAP_MARKER);
    const markersSent = () => captureMessage.mock.calls.filter(([message]) => message === CAP_MARKER);

    afterEach(() => {
      jest.useRealTimers();
    });

    it('sends at most 100 distinct warns per day, plus one marker per capped window', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      // A fresh module: the shared `logger` has daily slots spent by other tests.
      let fresh!: typeof logger;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ({ logger: fresh } = require('./logger'));
      });

      for (let i = 0; i < 150; i++) fresh.warn(`warn ${i}`);

      expect(warnsSent()).toHaveLength(100);
      expect(markersSent()).toEqual([[CAP_MARKER, 'warning']]);

      jest.setSystemTime(Date.now() + DAY);
      for (let i = 0; i < 150; i++) fresh.warn(`next day warn ${i}`);

      expect(warnsSent()).toHaveLength(200);
      expect(markersSent()).toHaveLength(2);
    });
  });

  it('does not throttle logger.error', () => {
    for (let i = 0; i < 30; i++) logger.error('looping error');

    expect(captureMessage).toHaveBeenCalledTimes(30);
  });

  it('never sends logger.info to Sentry', () => {
    logger.info('just info');

    expect(captureMessage).not.toHaveBeenCalled();
  });
});
