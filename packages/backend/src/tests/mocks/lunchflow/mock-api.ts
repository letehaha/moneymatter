import { HttpResponse, http } from 'msw';

import { getMockedLunchFlowAccounts, getMockedLunchFlowBalance, getMockedLunchFlowTransactions } from './data';

export const VALID_LUNCHFLOW_API_KEY = 'valid-lunchflow-api-key-12345';
export const VALID_LUNCHFLOW_API_KEY_2 = 'valid-lunchflow-api-key-67890';
export const INVALID_LUNCHFLOW_API_KEY = 'invalid-lunchflow-api-key-12345';

export const LUNCHFLOW_BASE_URL = 'https://lunchflow.app/api/v1';

export const LUNCHFLOW_EXTERNAL_ACCOUNT_ID = '1001';

export const getLunchFlowAccountsMock = ({ response }: { response: ReturnType<typeof getMockedLunchFlowAccounts> }) => {
  return http.get(`${LUNCHFLOW_BASE_URL}/accounts`, () => {
    return HttpResponse.json(response);
  });
};

export const getLunchFlowTransactionsMock = ({
  response,
  accountId,
}: {
  response?: ReturnType<typeof getMockedLunchFlowTransactions>;
  accountId?: string | number;
} = {}) => {
  const urlPattern = accountId
    ? `${LUNCHFLOW_BASE_URL}/accounts/${accountId}/transactions`
    : new RegExp(`${LUNCHFLOW_BASE_URL}/accounts/\\d+/transactions`);

  return http.get(urlPattern, () => {
    return HttpResponse.json(response || getMockedLunchFlowTransactions());
  });
};

export const getLunchFlowBalanceMock = ({
  response,
  accountId,
}: {
  response?: ReturnType<typeof getMockedLunchFlowBalance>;
  accountId?: string | number;
} = {}) => {
  const urlPattern = accountId
    ? `${LUNCHFLOW_BASE_URL}/accounts/${accountId}/balance`
    : new RegExp(`${LUNCHFLOW_BASE_URL}/accounts/\\d+/balance`);

  return http.get(urlPattern, () => {
    return HttpResponse.json(response || getMockedLunchFlowBalance({ accountId }));
  });
};

export const lunchflowHandlers = [
  // GET /accounts - list all accounts
  http.get(`${LUNCHFLOW_BASE_URL}/accounts`, ({ request }) => {
    const apiKey = request.headers.get('x-api-key');
    const validKeys = [VALID_LUNCHFLOW_API_KEY, VALID_LUNCHFLOW_API_KEY_2];

    if (!apiKey || !validKeys.includes(apiKey)) {
      return new HttpResponse(JSON.stringify({ message: 'Invalid API key' }), {
        status: 403,
        statusText: 'Forbidden',
      });
    }

    return HttpResponse.json(getMockedLunchFlowAccounts());
  }),

  // GET /accounts/:accountId/transactions
  http.get(new RegExp(`${LUNCHFLOW_BASE_URL}/accounts/\\d+/transactions`), ({ request }) => {
    const apiKey = request.headers.get('x-api-key');
    const validKeys = [VALID_LUNCHFLOW_API_KEY, VALID_LUNCHFLOW_API_KEY_2];

    if (!apiKey || !validKeys.includes(apiKey)) {
      return new HttpResponse(null, { status: 403 });
    }

    return HttpResponse.json(getMockedLunchFlowTransactions());
  }),

  // GET /accounts/:accountId/balance
  http.get(new RegExp(`${LUNCHFLOW_BASE_URL}/accounts/\\d+/balance`), ({ request }) => {
    const apiKey = request.headers.get('x-api-key');
    const validKeys = [VALID_LUNCHFLOW_API_KEY, VALID_LUNCHFLOW_API_KEY_2];
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const accountId = pathParts[pathParts.indexOf('accounts') + 1];

    if (!apiKey || !validKeys.includes(apiKey)) {
      return new HttpResponse(null, { status: 403 });
    }

    return HttpResponse.json(getMockedLunchFlowBalance({ accountId }));
  }),
];
