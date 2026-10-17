import type { UserCurrencyModel } from '@bt/shared/types';

import {
  type RateSourceDraft,
  buildDraft,
  buildRateSourceBody,
  buildTestBody,
  createHeaderRow,
  getSavedHeaderNames,
  getTestFailureKey,
  isDraftChanged,
  isPositiveNumberText,
  isValidUrlTemplate,
  validateDraft,
} from './rate-source-draft';

type Saved = Pick<UserCurrencyModel, 'rateSource' | 'rateSourceConfig'>;

const MANUAL: Saved = { rateSource: 'manual', rateSourceConfig: null };
const PEG: Saved = { rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 1 } };
const COINGECKO: Saved = { rateSource: 'coingecko', rateSourceConfig: { coinId: 'bitcoin', quoteCurrency: 'EUR' } };
const HTTP: Saved = {
  rateSource: 'http',
  rateSourceConfig: {
    urlTemplate: 'https://api.example.com/{code}?on={date}',
    jsonPath: 'data.price',
    quoteCurrency: 'USD',
    headerNames: ['X-Api-Key'],
  },
};

const draftOf = ({ saved, patch }: { saved: Saved; patch?: (draft: RateSourceDraft) => void }) => {
  const draft = buildDraft({ saved });
  patch?.(draft);

  return draft;
};

describe('buildDraft', () => {
  it('reads an unset source as manual, since a custom currency has no market feed', () => {
    expect(buildDraft({ saved: { rateSource: 'provider', rateSourceConfig: null } }).source).toBe('manual');
  });

  it('seeds every form from the saved config', () => {
    expect(buildDraft({ saved: PEG }).peg).toEqual({ pegCurrency: 'USD', factor: '1' });
    expect(buildDraft({ saved: COINGECKO }).coingecko).toMatchObject({ coinId: 'bitcoin', quoteCurrency: 'EUR' });
    expect(buildDraft({ saved: HTTP }).http).toMatchObject({
      urlTemplate: 'https://api.example.com/{code}?on={date}',
      jsonPath: 'data.price',
      quoteCurrency: 'USD',
    });
  });

  it('defaults the quote currency of the synced sources to USD', () => {
    const draft = buildDraft({ saved: MANUAL });

    expect(draft.coingecko.quoteCurrency).toBe('USD');
    expect(draft.http.quoteCurrency).toBe('USD');
  });

  it('keeps saved headers and never holds their values', () => {
    const draft = buildDraft({ saved: HTTP });

    expect(draft.http.headersMode).toBe('keep');
    expect(draft.http.headers).toEqual([]);
    expect(getSavedHeaderNames({ saved: HTTP })).toEqual(['X-Api-Key']);
  });

  it('starts an HTTP source without saved headers in replace mode, and ignores headers of another source', () => {
    expect(buildDraft({ saved: MANUAL }).http.headersMode).toBe('replace');
    expect(getSavedHeaderNames({ saved: PEG })).toEqual([]);
  });
});

describe('buildRateSourceBody', () => {
  it('sends no config for the manual source', () => {
    expect(buildRateSourceBody({ draft: buildDraft({ saved: MANUAL }) })).toEqual({ rateSource: 'manual' });
  });

  it('sends the peg factor as a number', () => {
    const draft = draftOf({
      saved: PEG,
      patch: (item) => {
        item.source = 'peg';
        item.peg.factor = '0.00001';
      },
    });

    expect(buildRateSourceBody({ draft })).toEqual({
      rateSource: 'peg',
      config: { pegCurrency: 'USD', factor: 0.00001 },
    });
  });

  it('sends the coin and its quote currency', () => {
    expect(buildRateSourceBody({ draft: buildDraft({ saved: COINGECKO }) })).toEqual({
      rateSource: 'coingecko',
      config: { coinId: 'bitcoin', quoteCurrency: 'EUR' },
    });
  });

  it('omits headers while keeping the saved ones, so the API keeps them', () => {
    const body = buildRateSourceBody({ draft: buildDraft({ saved: HTTP }) });

    expect(body).toEqual({
      rateSource: 'http',
      config: {
        urlTemplate: 'https://api.example.com/{code}?on={date}',
        jsonPath: 'data.price',
        quoteCurrency: 'USD',
      },
    });
    expect('headers' in (body as { config: object }).config).toBe(false);
  });

  it('sends an empty object to remove the saved headers', () => {
    const draft = draftOf({
      saved: HTTP,
      patch: (item) => {
        item.http.headersMode = 'clear';
      },
    });

    expect(buildRateSourceBody({ draft })).toMatchObject({ config: { headers: {} } });
  });

  it('sends the typed rows as the new header set and drops blank ones', () => {
    const draft = draftOf({
      saved: HTTP,
      patch: (item) => {
        item.http.headersMode = 'replace';
        item.http.headers = [
          { ...createHeaderRow(), name: ' X-Api-Key ', value: 'secret' },
          createHeaderRow(),
          { ...createHeaderRow(), name: 'Accept', value: 'application/json' },
        ];
      },
    });

    expect(buildRateSourceBody({ draft })).toMatchObject({
      config: { headers: { 'X-Api-Key': 'secret', Accept: 'application/json' } },
    });
  });

  it('trims the URL and the path', () => {
    const draft = draftOf({
      saved: HTTP,
      patch: (item) => {
        item.http.urlTemplate = '  https://api.example.com/p  ';
        item.http.jsonPath = ' price ';
      },
    });

    expect(buildRateSourceBody({ draft })).toMatchObject({
      config: { urlTemplate: 'https://api.example.com/p', jsonPath: 'price' },
    });
  });
});

describe('buildTestBody', () => {
  it('previews the HTTP settings even while another tab is selected, with the same headers rule', () => {
    const draft = draftOf({
      saved: HTTP,
      patch: (item) => {
        item.source = 'peg';
      },
    });

    expect(buildTestBody({ http: draft.http })).toEqual({
      rateSource: 'http',
      config: {
        urlTemplate: 'https://api.example.com/{code}?on={date}',
        jsonPath: 'data.price',
        quoteCurrency: 'USD',
      },
    });
  });
});

describe('isDraftChanged', () => {
  it('is false for an untouched draft of every source', () => {
    for (const saved of [MANUAL, PEG, COINGECKO, HTTP]) {
      expect(isDraftChanged({ draft: buildDraft({ saved }), saved })).toBe(false);
    }
  });

  it('is true after switching the source or editing a setting', () => {
    expect(
      isDraftChanged({
        draft: draftOf({
          saved: MANUAL,
          patch: (item) => {
            item.source = 'peg';
          },
        }),
        saved: MANUAL,
      }),
    ).toBe(true);
    expect(
      isDraftChanged({
        draft: draftOf({
          saved: PEG,
          patch: (item) => {
            item.peg.factor = '2';
          },
        }),
        saved: PEG,
      }),
    ).toBe(true);
  });

  it('is true when only the saved headers are cleared', () => {
    const replacing = draftOf({
      saved: HTTP,
      patch: (item) => {
        item.http.headersMode = 'clear';
      },
    });
    expect(isDraftChanged({ draft: replacing, saved: HTTP })).toBe(true);
  });

  it('ignores edits to a form of a source that is not selected', () => {
    const draft = draftOf({
      saved: MANUAL,
      patch: (item) => {
        item.peg.factor = '5';
      },
    });

    expect(isDraftChanged({ draft, saved: MANUAL })).toBe(false);
  });
});

describe('validateDraft', () => {
  it('accepts a complete draft of every source', () => {
    for (const saved of [MANUAL, PEG, COINGECKO, HTTP]) {
      expect(validateDraft({ draft: buildDraft({ saved }) })).toEqual({});
    }
  });

  it('requires a peg currency and a positive factor', () => {
    const draft = draftOf({
      saved: MANUAL,
      patch: (item) => {
        item.source = 'peg';
        item.peg.factor = '0';
      },
    });

    expect(validateDraft({ draft })).toEqual({
      pegCurrency: 'settings.currencies.rateSource.errors.pegCurrencyRequired',
      factor: 'settings.currencies.rateSource.errors.factorInvalid',
    });
  });

  it('requires a coin for CoinGecko', () => {
    const draft = draftOf({
      saved: MANUAL,
      patch: (item) => {
        item.source = 'coingecko';
      },
    });

    expect(validateDraft({ draft })).toEqual({ coinId: 'settings.currencies.rateSource.errors.coinRequired' });
  });

  it('requires the URL and the path of an HTTP source, and an http(s) URL with known placeholders', () => {
    const blank = draftOf({
      saved: MANUAL,
      patch: (item) => {
        item.source = 'http';
      },
    });
    expect(validateDraft({ draft: blank })).toEqual({
      urlTemplate: 'settings.currencies.rateSource.errors.urlRequired',
      jsonPath: 'settings.currencies.rateSource.errors.pathRequired',
    });

    const unknownPlaceholder = draftOf({
      saved: HTTP,
      patch: (item) => {
        item.http.urlTemplate = 'https://api.example.com/{currency}';
      },
    });
    expect(validateDraft({ draft: unknownPlaceholder }).urlTemplate).toBe(
      'settings.currencies.rateSource.errors.urlInvalid',
    );
  });

  it('refuses a header without a name and duplicate header names', () => {
    const nameless = draftOf({
      saved: HTTP,
      patch: (item) => {
        item.http.headersMode = 'replace';
        item.http.headers = [{ ...createHeaderRow(), name: '', value: 'secret' }];
      },
    });
    expect(validateDraft({ draft: nameless }).headers).toBe('settings.currencies.rateSource.errors.headerNameRequired');

    const duplicate = draftOf({
      saved: HTTP,
      patch: (item) => {
        item.http.headersMode = 'replace';
        item.http.headers = [
          { ...createHeaderRow(), name: 'X-Key', value: 'a' },
          { ...createHeaderRow(), name: 'x-key', value: 'b' },
        ];
      },
    });
    expect(validateDraft({ draft: duplicate }).headers).toBe(
      'settings.currencies.rateSource.errors.headerNameDuplicate',
    );
  });

  it('does not check the forms of sources that are not selected', () => {
    const draft = draftOf({
      saved: MANUAL,
      patch: (item) => {
        item.http.urlTemplate = 'nonsense';
      },
    });

    expect(validateDraft({ draft })).toEqual({});
  });
});

describe('isValidUrlTemplate', () => {
  it.each([
    ['https://api.example.com/price', true],
    ['http://localhost:8080/{code}/{quote}?d={date}', true],
    ['ftp://example.com', false],
    ['api.example.com', false],
    ['https://api.example.com/{unknown}', false],
    ['https://api.example.com/{date', false],
    ['https://api.example.com/ x', false],
  ])('%s -> %s', (value, expected) => {
    expect(isValidUrlTemplate({ value })).toBe(expected);
  });
});

describe('isPositiveNumberText', () => {
  it.each([
    ['1', true],
    ['0.5', true],
    ['.5', true],
    ['1e-9', true],
    ['0', false],
    ['-1', false],
    ['abc', false],
    ['', false],
    ['1,5', false],
  ])('%j -> %s', (value, expected) => {
    expect(isPositiveNumberText({ value })).toBe(expected);
  });
});

describe('getTestFailureKey', () => {
  it('maps a reason to its message key', () => {
    expect(getTestFailureKey({ reason: 'path_not_found' })).toBe(
      'settings.currencies.rateSource.http.failures.path_not_found',
    );
  });
});
