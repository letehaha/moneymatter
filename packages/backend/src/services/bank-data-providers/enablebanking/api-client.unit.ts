import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@js/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, TooManyRequests } from '@js/errors';

import { EnableBankingApiClient, classifyAspspError, isAspspDateRangeRejection, safeStringify } from './api-client';

describe('safeStringify', () => {
  it('serializes plain objects normally', () => {
    expect(safeStringify({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
  });

  it('falls back to String(value) for circular references', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeStringify(circular)).toBe('[object Object]');
  });

  it('falls back to String(value) for BigInt values that break JSON.stringify', () => {
    expect(safeStringify(10n)).toBe('10');
  });

  it('falls back when toJSON throws', () => {
    const value = {
      toJSON() {
        throw new Error('broken toJSON');
      },
    };
    expect(safeStringify(value)).toBe('[object Object]');
  });
});

describe('classifyAspspError', () => {
  describe('nested code branch', () => {
    it.each([
      ['string "401 UNAUTHORIZED"', '401 UNAUTHORIZED'],
      ['string "403 FORBIDDEN"', '403 FORBIDDEN'],
      ['string "401"', '401'],
      ['string with leading whitespace', '  403 forbidden'],
    ])('matches when error_data.code is %s', (_label, code) => {
      const result = classifyAspspError({ detail: { error_data: { code } } });
      expect(result).toEqual({ matched: true, reason: 'nested-code' });
    });

    it.each([401, 403])('matches when error_data.code is numeric %i', (code) => {
      const result = classifyAspspError({ detail: { error_data: { code } } });
      expect(result).toEqual({ matched: true, reason: 'nested-code' });
    });

    it.each([
      ['string "400"', '400 BAD REQUEST'],
      ['string "500"', '500 INTERNAL'],
      ['numeric 500', 500],
    ])('does not match when error_data.code is %s', (_label, code) => {
      const result = classifyAspspError({ detail: { error_data: { code } } });
      expect(result.matched).toBe(false);
    });
  });

  describe('nested status branch', () => {
    it.each([401, 403])('matches when error_data.status is numeric %i', (status) => {
      const result = classifyAspspError({ detail: { error_data: { status } } });
      expect(result).toEqual({ matched: true, reason: 'nested-status' });
    });

    it.each(['401', '403 FORBIDDEN'])('matches when error_data.status is string "%s"', (status) => {
      const result = classifyAspspError({ detail: { error_data: { status } } });
      expect(result).toEqual({ matched: true, reason: 'nested-status' });
    });

    it('does not match for 500-level numeric status', () => {
      expect(classifyAspspError({ detail: { error_data: { status: 500 } } }).matched).toBe(false);
    });
  });

  describe('keyword-match branch', () => {
    it.each([
      'Refresh token invalid',
      'refresh_token expired',
      'token expired',
      'token has been revoked',
      'session expired',
      'session is invalid',
      'consent revoked',
      'consent withdrawn',
      'reauthorization required',
      'Please reauthenticate',
      'Access token not allowed',
      'Forbidden, authenticated but access to resource is not allowed',
      'PSD2 consent has expired',
    ])('matches auth keyword in wrapper message: "%s"', (aspspMessage) => {
      const result = classifyAspspError({ detail: {}, aspspMessage });
      expect(result).toEqual({ matched: true, reason: 'keyword-match' });
    });

    it.each([
      'Operation forbidden by bank during maintenance window',
      'transaction date forbidden',
      'this character is not allowed in description',
      'unauthorized transactions report',
      'Invalid IBAN format',
      'Insufficient funds',
    ])('does NOT match unrelated wording with bare keywords: "%s"', (aspspMessage) => {
      const result = classifyAspspError({ detail: {}, aspspMessage });
      expect(result.matched).toBe(false);
    });

    it.each([
      'The consent status does not allow the requested access.',
      'Consent status does not allow requested access',
      "The consent status doesn't allow the requested access",
    ])('matches consent-status refusals: "%s"', (aspspMessage) => {
      const result = classifyAspspError({ detail: {}, aspspMessage });
      expect(result).toEqual({ matched: true, reason: 'keyword-match' });
    });

    it.each([
      'The dateFrom and dateTo must be within 2 years',
      'Date range cannot exceed 90 days',
      'Transaction history limited to 13 months',
      'The date must be equal or less than 13 months',
    ])('does NOT match date-range rejections: "%s"', (aspspMessage) => {
      expect(classifyAspspError({ detail: {}, aspspMessage }).matched).toBe(false);
    });

    it('matches when the auth keyword appears only in nested message', () => {
      const result = classifyAspspError({
        detail: { error_data: { message: 'Refresh token expired and must be renewed' } },
      });
      expect(result).toEqual({ matched: true, reason: 'keyword-match' });
    });
  });

  describe('missing or empty input', () => {
    it('returns no match for empty detail and undefined aspspMessage', () => {
      expect(classifyAspspError({ detail: {} }).matched).toBe(false);
    });

    it('returns no match when error_data is missing', () => {
      expect(classifyAspspError({ detail: { message: 'Operation failed' } }).matched).toBe(false);
    });

    it('returns no match when error_data fields are unexpected types', () => {
      expect(
        classifyAspspError({
          detail: { error_data: { code: { nested: 'object' }, status: ['array'], message: 12345 } },
        }).matched,
      ).toBe(false);
    });
  });
});

const makeAspspBadRequest = ({
  method = 'getAccountTransactions',
  aspspError = 'ASPSP_ERROR',
  aspspMessage,
  aspspErrorDataStr,
  message = 'Some upstream error',
}: {
  method?: string;
  aspspError?: string;
  aspspMessage?: string;
  aspspErrorDataStr?: string;
  message?: string;
}): BadRequestError =>
  new BadRequestError({
    message,
    details: { method, aspspError, aspspMessage, aspspErrorDataStr },
  });

describe('isAspspDateRangeRejection', () => {
  it.each([
    'The dateFrom and dateTo must be within 2 years',
    'The dateFrom and dateTo must be within 730 days',
    'dateFrom cannot be older than 24 months',
  ])('matches BNP-Fortis-style "dateFrom/dateTo" phrasing: "%s"', (aspspMessage) => {
    expect(isAspspDateRangeRejection(makeAspspBadRequest({ aspspMessage }))).toBe(true);
  });

  it.each([
    'Date range cannot exceed 90 days',
    'Maximum lookback is 365 days',
    'Transaction history limited to 13 months',
    'Requested period exceeds 2 years',
    'Transactions older than 90 days are not available',
    'The date must be equal or less than 13 months',
    'The date must be less than 24 months',
    'Period must be no more than 90 days',
    'You can not request transactions more than 90 days in the past',
    'One or more date fields are more than two years in the past.',
  ])('matches generic limit phrasings: "%s"', (aspspMessage) => {
    expect(isAspspDateRangeRejection(makeAspspBadRequest({ aspspMessage }))).toBe(true);
  });

  it('matches when limit phrasing is in aspspErrorDataStr only', () => {
    expect(
      isAspspDateRangeRejection(
        makeAspspBadRequest({
          aspspMessage: 'Error interacting with ASPSP',
          aspspErrorDataStr: '{"status":400,"message":"date range cannot exceed 90 days"}',
        }),
      ),
    ).toBe(true);
  });

  it('does NOT match generic 400s from the transactions endpoint with no date vocabulary', () => {
    expect(isAspspDateRangeRejection(makeAspspBadRequest({ aspspMessage: 'Account not found for this session' }))).toBe(
      false,
    );
  });

  it('does NOT match a limit-keyword without a time-unit number', () => {
    expect(isAspspDateRangeRejection(makeAspspBadRequest({ aspspMessage: 'Date range cannot be empty' }))).toBe(false);
  });

  it('does NOT match a time-unit number without a limit keyword', () => {
    expect(isAspspDateRangeRejection(makeAspspBadRequest({ aspspMessage: 'Transaction posted 5 days ago' }))).toBe(
      false,
    );
  });

  it('does NOT match errors from other endpoints', () => {
    expect(
      isAspspDateRangeRejection(
        makeAspspBadRequest({
          method: 'createSession',
          aspspMessage: 'The dateFrom and dateTo must be within 2 years',
        }),
      ),
    ).toBe(false);
  });

  it('does NOT match non-BadRequest errors', () => {
    const forbidden = new ForbiddenError({
      message: 'auth failure',
      details: { method: 'getAccountTransactions', aspspMessage: 'dateFrom expired' },
    });
    expect(isAspspDateRangeRejection(forbidden)).toBe(false);
  });

  it('does NOT match plain Error instances', () => {
    expect(isAspspDateRangeRejection(new Error('dateFrom 2 years'))).toBe(false);
  });

  it('does NOT match BadRequestError with no details', () => {
    expect(isAspspDateRangeRejection(new BadRequestError({ message: 'dateFrom 2 years' }))).toBe(false);
  });

  it('does NOT match Enable Banking own-validation 400s (unrelated message, regardless of aspspError tag)', () => {
    expect(
      isAspspDateRangeRejection(
        makeAspspBadRequest({ aspspError: 'INVALID_REQUEST', aspspMessage: 'dateTo is required' }),
      ),
    ).toBe(false);
  });

  it('matches regardless of the aspspError tag value, as long as method + message qualify (BNP puts its own code there, not "ASPSP_ERROR")', () => {
    expect(
      isAspspDateRangeRejection(
        makeAspspBadRequest({
          aspspError: 'WRONG_TRANSACTIONS_PERIOD',
          aspspMessage: 'The date must be equal or less than 13 months',
        }),
      ),
    ).toBe(true);
  });

  it('matches when the aspspError tag is missing entirely, as long as method + message qualify', () => {
    const err = new BadRequestError({
      message: 'something',
      details: { method: 'getAccountTransactions', aspspMessage: 'history limited to 13 months' },
    });
    expect(isAspspDateRangeRejection(err)).toBe(true);
  });

  it('does NOT match "dateTo is required" – field name without a limit verb', () => {
    expect(isAspspDateRangeRejection(makeAspspBadRequest({ aspspMessage: 'dateTo is required' }))).toBe(false);
  });

  it('does NOT match limit-verb + time-window without a concept anchor (no field name, no range noun)', () => {
    expect(
      isAspspDateRangeRejection(
        makeAspspBadRequest({ aspspMessage: 'Account opened within last 30 days; limited access' }),
      ),
    ).toBe(false);
  });

  it('matches when the limit phrasing appears only in error.message (not aspspMessage)', () => {
    const err = new BadRequestError({
      message: 'Date range cannot exceed 90 days',
      details: { method: 'getAccountTransactions', aspspError: 'ASPSP_ERROR' },
    });
    expect(isAspspDateRangeRejection(err)).toBe(true);
  });
});

describe('handleApiError', () => {
  const handleApiError = (error: unknown) => {
    const client = new EnableBankingApiClient({ appId: 'app-id', privateKey: 'private-key' });
    return (client as unknown as { handleApiError: (error: unknown, method: string) => never }).handleApiError(
      error,
      'getAccountTransactions',
    );
  };

  it('throws TooManyRequests for a 429, even when its message matches an auth keyword', () => {
    const message = 'Rate limit exceeded for this access token';
    const error = Object.assign(new Error(message), {
      isAxiosError: true,
      config: { url: '/accounts/acc-1/transactions', method: 'get' },
      response: { status: 429, data: { error: 'ASPSP_ERROR', detail: { message } } },
    });

    expect(() => handleApiError(error)).toThrow(TooManyRequests);
    expect(() => handleApiError(error)).toThrow(t({ key: 'bankDataProviders.enableBanking.rateLimitExceeded' }));
    expect(() => handleApiError(error)).not.toThrow(ForbiddenError);
  });
});
