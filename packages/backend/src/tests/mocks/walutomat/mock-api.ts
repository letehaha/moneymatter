import type { HistoryItem } from '@services/bank-data-providers/walutomat/api-client';
import { HttpResponse, http } from 'msw';

import { getMockedWalutomatBalances, getMockedWalutomatHistory } from './data';

export const VALID_WALUTOMAT_API_KEY = 'valid-walutomat-api-key-12345';
export const VALID_WALUTOMAT_API_KEY_2 = 'valid-walutomat-api-key-67890';
export const INVALID_WALUTOMAT_API_KEY = 'invalid-walutomat-api-key-00000';

// A real RSA private key for testing. Required because the API client signs requests
// with crypto.createSign() BEFORE the HTTP request is made (before MSW can intercept).
export const VALID_WALUTOMAT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCbQGPaFU2QykuG
HH7mU7YgI7uyvuZKNp6nEIErWTDxNGhZrjscCfHxxC5ercFz8ewiVtO3t/yQNb3M
guuXd4YnO08MAL8E4QhZNCBJYaIQChHVbyOHnntiXBnxYOAip+t3PNlG4Kjwo+zd
7l9xgKcm0pqmZD82N7yLbizoOSpIDgxBMRMlEYUsCftBa3jo14VXgsxyCewMoRTx
gbVMGjf1fY3FEqRndGTB+apI5Tn/dsQp9Npr7YZATE1Mxyc+iRWmIxil6pzTYl31
RnmwlAcHVDbJLFOF4Btqh+RI/3vf539qGX7mXHv444zAvumGy1kqRZ18vpWZgAxh
/BSRBg+BAgMBAAECggEAE0mmnhtzbX+Ubm7v3RGdWNTXptdMqP+sKjlEsuv7xpuq
MyoQMeWSZ2TmFeEkXZE6svFykCqNeCUVFWlWd5Tj18/ofCdDlAmZDewJ7tPwXGnD
2W5bTagE0C19E53jeqq9+CxZGhMjKfJTpSbOOL2xBoO3ruBZchTumavwbFFdzWGv
0igjKb7i+4xc3Ga41ASx3R29rdOCvw8HpYxWeDjyI7DaouQtbjdPH7r7Qfu0SUMv
kEBtvUGp7/VlcVSdt+e9V4pdENbm773d3JReFqIqL/YRKwOqhF4qyoXI6F4KEaAZ
ES7dVudmaBxIa/oOmOP7xg6tdHr7aVemnxSLEAmCoQKBgQDQgKEAFGleJRA/jCx9
D92kAuSSmZo6OYyfD7bwJXzn2iTFHJc63AHFYonAFeigweFRc7yIUtPmkZ4hV7Zf
NmiWp/Xhq+0ut1uFfbLb+ioMvdKP9oogh4n0cT3KecK16ViHIdhYK5vLEXfb4ytb
QCMYtgCuU0ORT/FegQI94rHiJQKBgQC+nkrcXB2ozkZgMCJVPryyrTvZxckI1nuR
WBO2+/9meTN7wl1X/N3sT1Xpqm+KrxsM25K/doBWn4vbIPTkD8C/aJXVmDTmkxp6
UOVYEZZpJbeyO8/eGWr+RCp8+PZkgPXjjZ4TvvFSZ66VICfBPrcyfiC6fet01tLo
xygt8gljLQKBgAh8I5EoQ310Tqv3XVwdiCyDfZ/FpnQWIXXbots0+1dIFlT7K+BW
UbAhqW9qtNPN8AhriFGX5U2twVykACTxxuHSpfvwDi/ngE73ZY70KD/qfaYkJ0zZ
lzCeZyBVQio6+8JMC0zTQXzLEjCdlwcYnhUEWxS9CLPiJ/VrlJbGIe0NAoGBAJ/y
kz50zS5oaAUuXqDJE+2aDy6dGCOiVe2Pynsw2Q5ThS/D2C+Mr2sq5xw7N31XkYso
c+rUtLv7BI/LB7KWxVXXnGKuZTVVGlKorslHeL6iN5IHPlVPXsgcysoy3g1XaPyY
SJypDDXpakUXxkQRLAfibfQO1RQlbrSE6OIkxlvBAoGAFxWd+vjrnFDNLORs5nhm
gFT1g/J2ygumCEYNPWFEbB412Yyt/K8hPZ1jwedQKu+VGwiO+DewNiPfgGU9Ce/+
exUZ/IlseSyqytXCc+FKOtXdQzcLucnatyPQ6fxQ0twuPUcY8cp7om3YYRvuT5cW
UxaMcWvIpy51nH62k9jrTyw=
-----END PRIVATE KEY-----`;

const WALUTOMAT_BASE_URL = 'https://api.walutomat.pl/api/v2.0.0';

const forbiddenResponse = () =>
  HttpResponse.json(
    {
      success: false,
      errors: [{ key: 'UNAUTHORIZED', description: 'Invalid API key' }],
    },
    { status: 403 },
  );

/**
 * Override handler for balances endpoint with custom response.
 */
export const getWalutomatBalancesMock = ({
  response,
}: {
  response?: ReturnType<typeof getMockedWalutomatBalances>;
} = {}) => {
  return http.get(`${WALUTOMAT_BASE_URL}/account/balances`, () => {
    return HttpResponse.json({
      success: true,
      result: response || getMockedWalutomatBalances(),
    });
  });
};

export const getWalutomatForbiddenBalancesMock = () =>
  http.get(`${WALUTOMAT_BASE_URL}/account/balances`, () => forbiddenResponse());

/**
 * Override handler for history endpoint with custom response.
 */
export const getWalutomatHistoryMock = ({
  response,
  respectDateRange = false,
}: {
  response?: ReturnType<typeof getMockedWalutomatHistory>;
  /** Filter items by the `dateFrom`/`dateTo` query params, like the real API. */
  respectDateRange?: boolean;
} = {}) => {
  return http.get(`${WALUTOMAT_BASE_URL}/account/history`, ({ request }) => {
    const items = response || getMockedWalutomatHistory();
    const params = new URL(request.url).searchParams;
    const dateFrom = params.get('dateFrom');
    const dateTo = params.get('dateTo');
    const from = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
    const to = dateTo ? new Date(dateTo).getTime() : Infinity;

    return HttpResponse.json({
      success: true,
      result: respectDateRange
        ? items.filter((item) => {
            const ts = new Date(item.ts).getTime();
            return ts >= from && ts <= to;
          })
        : items,
    });
  });
};

export const getWalutomatForbiddenHistoryMock = () =>
  http.get(`${WALUTOMAT_BASE_URL}/account/history`, () => forbiddenResponse());

/**
 * Override handler for history endpoint that returns different items per currency.
 * Used for testing FX auto-linking where each wallet gets its own side of the trade.
 */
export const getWalutomatHistoryByCurrencyMock = ({
  responseByCurrency,
}: {
  responseByCurrency: Record<string, HistoryItem[]>;
}) => {
  return http.get(`${WALUTOMAT_BASE_URL}/account/history`, ({ request }) => {
    const url = new URL(request.url);
    const currency = url.searchParams.get('currencies') || '';
    const items = responseByCurrency[currency] || [];
    return HttpResponse.json({
      success: true,
      result: items,
    });
  });
};

/**
 * Default MSW handlers for Walutomat API.
 * Validates the X-API-Key header against known valid keys.
 */
export const walutomatHandlers = [
  // GET /account/balances
  http.get(`${WALUTOMAT_BASE_URL}/account/balances`, ({ request }) => {
    const apiKey = request.headers.get('X-API-Key');
    const validKeys = [VALID_WALUTOMAT_API_KEY, VALID_WALUTOMAT_API_KEY_2];

    if (!apiKey || !validKeys.includes(apiKey)) {
      return forbiddenResponse();
    }

    return HttpResponse.json({
      success: true,
      result: getMockedWalutomatBalances(),
    });
  }),

  // GET /account/history
  http.get(`${WALUTOMAT_BASE_URL}/account/history`, ({ request }) => {
    const apiKey = request.headers.get('X-API-Key');
    const validKeys = [VALID_WALUTOMAT_API_KEY, VALID_WALUTOMAT_API_KEY_2];

    if (!apiKey || !validKeys.includes(apiKey)) {
      return forbiddenResponse();
    }

    // Parse currency filter from query params
    const url = new URL(request.url);
    const currenciesParam = url.searchParams.get('currencies');
    const currency = currenciesParam || 'EUR';

    return HttpResponse.json({
      success: true,
      result: getMockedWalutomatHistory({ currency }),
    });
  }),
];
