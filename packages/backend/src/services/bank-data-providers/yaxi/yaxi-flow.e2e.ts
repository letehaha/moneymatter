import { BANK_PROVIDER_TYPE, DEACTIVATION_REASON, TRANSACTION_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import {
  AccessExceededException,
  CanceledException,
  InterruptErrorException,
  InvalidCredentialsException,
  MOCK_YAXI_EXTERNAL_ID,
  MOCK_YAXI_KEY,
  NotFoundException,
  PeriodOutOfBoundsException,
  ProviderErrorException,
  RequestException,
  ServiceBlockedException,
  mockYaxiBank,
} from '@tests/mocks/routex-refresh-client';
import { addDays, differenceInCalendarDays, format, startOfDay, subDays } from 'date-fns';
import { createHmac } from 'node:crypto';
import { Op } from 'sequelize';

const SECOND_IBAN = 'DE89370400440532013000';
const SECOND_EXTERNAL_ID = `${SECOND_IBAN}:EUR`;

const daysAgo = ({ days }: { days: number }) => format(subDays(new Date(), days), 'yyyy-MM-dd');

const row = (overrides: Record<string, unknown> = {}) => ({
  status: 'BOOKED',
  bookingDate: daysAgo({ days: 3 }),
  amount: { amount: '-12.50', currency: 'EUR' },
  creditor: { name: 'Coffee Shop', iban: 'DE89370400440532013000' },
  debtor: { name: 'Test User' },
  remittanceInformation: ['Flat white', 'Card 1234'],
  ...overrides,
});

const connectAccount = async () => {
  const { connectionId } = await helpers.yaxi.connectAndLogin();
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [MOCK_YAXI_EXTERNAL_ID],
    raw: true,
  });

  return { connectionId, accountId: syncedAccounts[0]!.id };
};

const connectTwoAccounts = async () => {
  mockYaxiBank.accounts.push({ iban: SECOND_IBAN, currency: 'EUR', name: 'Savings' });
  const { connectionId } = await helpers.yaxi.connectAndLogin();
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [MOCK_YAXI_EXTERNAL_ID, SECOND_EXTERNAL_ID],
    raw: true,
  });

  return {
    connectionId,
    firstId: syncedAccounts.find((account) => account.externalId === MOCK_YAXI_EXTERNAL_ID)!.id,
    secondId: syncedAccounts.find((account) => account.externalId === SECOND_EXTERNAL_ID)!.id,
  };
};

const linkAccount = async () => {
  const { account } = await helpers.createAccountWithNewCurrency({ currency: 'EUR' });
  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId: account.id }),
    raw: true,
  });
  const { connectionId } = await helpers.yaxi.connectAndLogin();

  return {
    accountId: account.id,
    connectionId,
    link: () =>
      helpers.linkAccountToBankConnection({
        id: account.id,
        connectionId,
        externalAccountId: MOCK_YAXI_EXTERNAL_ID,
      }),
  };
};

const importedOriginalIds = async ({ accountId }: { accountId: string }) =>
  Transactions.findAll({ where: { accountId, originalId: { [Op.ne]: null } } });

const syncConnection = async ({ connectionId }: { connectionId: string }) => {
  await helpers.yaxi.waitForJobRemoval({ connectionId });
  await helpers.bankDataProviders.syncConnection({ connectionId, raw: true });
  await helpers.bankDataProviders.waitForAccountsSyncToSettle();
};

const getConnection = async ({ connectionId }: { connectionId: string }) =>
  (await BankDataProviderConnections.findByPk(connectionId))!;

const errorMessage = ({ response }: { response: { body: { response: unknown } } }) =>
  (response.body.response as { message: string }).message;

const authFailures = async ({ connectionId }: { connectionId: string }) =>
  ((await getConnection({ connectionId })).metadata as { consecutiveAuthFailures?: number }).consecutiveAuthFailures ??
  0;

const accountStatus = async ({ accountId }: { accountId: string }) => {
  const { accounts } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
  return accounts.find((account) => account.accountId === accountId);
};

describe('YAXI Data Provider E2E', () => {
  beforeEach(() => {
    mockYaxiBank.reset();
  });

  describe('Availability', () => {
    it('is closed on cloud for users without a connection', async () => {
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });
      expect(providers.map((provider) => provider.type)).not.toContain(BANK_PROVIDER_TYPE.YAXI);

      const response = await helpers.yaxi.connect();
      expect(response.statusCode).toBe(ERROR_CODES.NotAllowed);
      expect(JSON.stringify(response.body)).toContain(t({ key: 'bankDataProviders.providerNotAvailable' }));
    });

    it('is open in local dev, where IS_SELF_HOST is unset', async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });
        expect(providers.map((provider) => provider.type)).toContain(BANK_PROVIDER_TYPE.YAXI);
      } finally {
        process.env.NODE_ENV = previous;
      }
    });

    it('stays closed on cloud for a user holding a connection row, which a backup restore can create', async () => {
      process.env.IS_SELF_HOST = 'true';
      try {
        expect((await helpers.yaxi.connect()).statusCode).toBe(200);
      } finally {
        delete process.env.IS_SELF_HOST;
      }

      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });
      expect(providers.map((provider) => provider.type)).not.toContain(BANK_PROVIDER_TYPE.YAXI);
      expect((await helpers.yaxi.connect()).statusCode).toBe(ERROR_CODES.NotAllowed);
    });

    it('rejects the ticket, completion and new credentials for a connection row on cloud', async () => {
      process.env.IS_SELF_HOST = 'true';
      let connectionId: string;
      let resultJwt: string;
      try {
        ({ connectionId } = await helpers.yaxi.connect({ raw: true }));
        const { ticket } = await helpers.yaxi.issueTicket({ connectionId, raw: true });
        resultJwt = helpers.yaxi.buildResultJwt({ ticketId: helpers.yaxi.decodeTicketId({ ticket }) });
      } finally {
        delete process.env.IS_SELF_HOST;
      }
      const { credentials } = await getConnection({ connectionId });

      for (const response of [
        await helpers.yaxi.issueTicket({ connectionId }),
        await helpers.yaxi.complete({ connectionId, resultJwt }),
        await helpers.bankDataProviders.updateConnectionDetails({ connectionId, credentials: MOCK_YAXI_KEY }),
      ]) {
        expect(response.statusCode).toBe(ERROR_CODES.NotAllowed);
        expect(errorMessage({ response })).toBe(t({ key: 'bankDataProviders.providerNotAvailable' }));
      }

      const connection = await getConnection({ connectionId });
      expect(connection.isActive).toBe(false);
      expect(connection.credentials).toBe(credentials);
    });
  });

  describe('Self-hosted', () => {
    useSelfHost();

    describe('Connecting', () => {
      it('creates a pending connection for a valid key', async () => {
        const response = await helpers.yaxi.connect();
        expect(response.statusCode).toBe(200);

        const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
        expect(connections[0]).toMatchObject({
          id: response.body.response.connectionId,
          providerType: BANK_PROVIDER_TYPE.YAXI,
          providerName: 'YAXI',
          isActive: false,
        });
      });

      it('continues an abandoned first login when the same key is pasted again', async () => {
        const first = await helpers.yaxi.connect();
        const second = await helpers.yaxi.connect();
        expect(second.body.response.connectionId).toBe(first.body.response.connectionId);

        const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
        expect(connections).toHaveLength(1);
        expect(connections[0]).toMatchObject({ providerName: 'YAXI' });
      });

      it('rejects a key YAXI does not accept and creates no connection', async () => {
        const response = await helpers.yaxi.connect({
          credentials: { ...MOCK_YAXI_KEY, secret: Buffer.from('some-other-secret-value').toString('base64') },
        });
        expect(response.statusCode).toBe(ERROR_CODES.Forbidden);

        const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
        expect(connections).toEqual([]);
      });

      it('rejects a malformed key', async () => {
        const response = await helpers.yaxi.connect({ credentials: { keyId: 'x', secret: 'not base64!' } });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      });

      it('reports an upstream outage on connect as unavailable, not as an invalid key', async () => {
        mockYaxiBank.failWith = new ProviderErrorException();

        const response = await helpers.yaxi.connect();

        expect(response.statusCode).toBe(ERROR_CODES.ServiceUnavailable);
        expect(errorMessage({ response })).toBe(t({ key: 'bankDataProviders.yaxi.unavailable' }));
      });

      it('refuses to list accounts before the bank login completes', async () => {
        const response = await helpers.yaxi.connect();
        const listed = await helpers.bankDataProviders.listExternalAccounts({
          connectionId: response.body.response.connectionId,
        });
        expect(listed.statusCode).toBe(ERROR_CODES.Forbidden);
      });
    });

    describe('Browser ticket', () => {
      it('issues an Accounts ticket signed with the user key, on the URL the key belongs to', async () => {
        const { body } = await helpers.yaxi.connect();
        const { ticket, apiUrl } = await helpers.yaxi.issueTicket({
          connectionId: body.response.connectionId,
          raw: true,
        });

        expect(apiUrl).toBe('https://integration.yaxi.tech/');

        const [header, payload, signature] = ticket.split('.') as [string, string, string];
        expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
          alg: 'HS256',
          typ: 'JWT',
          kid: MOCK_YAXI_KEY.keyId,
        });

        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
        expect(decoded.data.service).toBe('Accounts');
        expect(decoded.exp * 1000).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
        expect(signature).toBe(
          createHmac('sha256', Buffer.from(MOCK_YAXI_KEY.secret, 'base64'))
            .update(`${header}.${payload}`)
            .digest('base64url'),
        );
      });

      it('ignores any service the client asks for', async () => {
        const { connectionId } = await helpers.yaxi.connect({ raw: true });
        const response = await helpers.yaxi.issueTicket({
          connectionId,
          payload: { service: 'CollectPayment' },
          raw: true,
        });

        const decoded = JSON.parse(Buffer.from(response.ticket.split('.')[1]!, 'base64url').toString());
        expect(decoded.data.service).toBe('Accounts');
      });

      it('resolves a production key to the production URL', async () => {
        const key = { keyId: 'api-key-production-1', secret: MOCK_YAXI_KEY.secret };
        mockYaxiBank.key = key;

        const { connectionId } = await helpers.yaxi.connect({ credentials: key, raw: true });
        const { apiUrl } = await helpers.yaxi.issueTicket({ connectionId, raw: true });

        expect(apiUrl).toBe('https://api.yaxi.tech/');
        expect(mockYaxiBank.clientOptions.at(-1)!.url.href).toBe('https://api.yaxi.tech/');
      });
    });

    describe('Completing the login', () => {
      it('activates the connection and stores the bank details', async () => {
        const { body } = await helpers.yaxi.connect();
        const { connectionId } = body.response;

        const response = await helpers.yaxi.login({ connectionId });
        expect(response.statusCode).toBe(200);
        expect(response.body.response).toEqual({ connectionId });

        const details = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
        expect(details.connection).toMatchObject({
          isActive: true,
          providerName: 'Mock Bank',
          deactivationReason: null,
        });
      });

      it('rejects a result signed with another secret and changes nothing', async () => {
        const { body } = await helpers.yaxi.connect();
        const { connectionId } = body.response;
        const { ticket } = await helpers.yaxi.issueTicket({ connectionId, raw: true });

        const response = await helpers.yaxi.complete({
          connectionId,
          resultJwt: helpers.yaxi.buildResultJwt({
            ticketId: helpers.yaxi.decodeTicketId({ ticket }),
            secret: Buffer.from('some-other-secret-value').toString('base64'),
          }),
        });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(errorMessage({ response })).toBe(t({ key: 'bankDataProviders.yaxi.invalidResult' }));
        expect((await getConnection({ connectionId })).isActive).toBe(false);
      });

      it('rejects a result bound to another ticket and changes nothing', async () => {
        const { body } = await helpers.yaxi.connect();
        const { connectionId } = body.response;
        await helpers.yaxi.issueTicket({ connectionId, raw: true });

        const response = await helpers.yaxi.complete({
          connectionId,
          resultJwt: helpers.yaxi.buildResultJwt({ ticketId: 'another-ticket' }),
        });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(errorMessage({ response })).toBe(t({ key: 'bankDataProviders.yaxi.invalidResult' }));
        expect((await getConnection({ connectionId })).isActive).toBe(false);
      });

      it('rejects replaying a result that was already used', async () => {
        const { body } = await helpers.yaxi.connect();
        const { connectionId } = body.response;
        const { ticket } = await helpers.yaxi.issueTicket({ connectionId, raw: true });
        const resultJwt = helpers.yaxi.buildResultJwt({ ticketId: helpers.yaxi.decodeTicketId({ ticket }) });

        expect((await helpers.yaxi.complete({ connectionId, resultJwt })).statusCode).toBe(200);

        const replay = await helpers.yaxi.complete({ connectionId, resultJwt });
        expect(replay.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(errorMessage({ response: replay })).toBe(t({ key: 'bankDataProviders.yaxi.invalidResult' }));
      });

      it('accepts one of two concurrent completions with the same result', async () => {
        const { connectionId } = await helpers.yaxi.connect({ raw: true });
        const { ticket } = await helpers.yaxi.issueTicket({ connectionId, raw: true });
        const resultJwt = helpers.yaxi.buildResultJwt({ ticketId: helpers.yaxi.decodeTicketId({ ticket }) });

        const responses = await Promise.all([
          helpers.yaxi.complete({ connectionId, resultJwt }),
          helpers.yaxi.complete({ connectionId, resultJwt }),
        ]);

        expect(responses.map((response) => response.statusCode).toSorted()).toEqual([200, ERROR_CODES.ValidationError]);
      });

      it('rejects connection data YAXI does not recognise', async () => {
        const { body } = await helpers.yaxi.connect();
        const { connectionId } = body.response;
        const { ticket } = await helpers.yaxi.issueTicket({ connectionId, raw: true });

        const response = await helpers.yaxi.complete({
          connectionId,
          resultJwt: helpers.yaxi.buildResultJwt({ ticketId: helpers.yaxi.decodeTicketId({ ticket }) }),
          connectionData: Buffer.from('forged').toString('base64'),
        });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(errorMessage({ response })).toBe(t({ key: 'bankDataProviders.yaxi.invalidConnectionData' }));
        expect((await getConnection({ connectionId })).isActive).toBe(false);
      });

      it("rejects both endpoints on another user's connection", async () => {
        const { body } = await helpers.yaxi.connect();
        const { connectionId } = body.response;
        const { ticket } = await helpers.yaxi.issueTicket({ connectionId, raw: true });
        const resultJwt = helpers.yaxi.buildResultJwt({ ticketId: helpers.yaxi.decodeTicketId({ ticket }) });

        const userB = await helpers.provisionSecondUserWithBaseCurrency();
        await helpers.asUser({
          cookies: userB.cookies,
          fn: async () => {
            const ticketResponse = await helpers.yaxi.issueTicket({ connectionId });
            expect(ticketResponse.statusCode).toBe(ERROR_CODES.NotFoundError);

            const completeResponse = await helpers.yaxi.complete({ connectionId, resultJwt });
            expect(completeResponse.statusCode).toBe(ERROR_CODES.NotFoundError);
          },
        });

        expect((await getConnection({ connectionId })).isActive).toBe(false);
      });

      it('never returns or stores the key or connection data in the clear', async () => {
        const connectionData = mockYaxiBank.connectionData.toString('base64');
        const { body: connectBody } = await helpers.yaxi.connect();
        const { connectionId } = connectBody.response;
        const bodies = [JSON.stringify(connectBody)];

        const ticketResponse = await helpers.yaxi.issueTicket({ connectionId });
        bodies.push(JSON.stringify(ticketResponse.body));
        const completeResponse = await helpers.yaxi.complete({
          connectionId,
          resultJwt: helpers.yaxi.buildResultJwt({
            ticketId: helpers.yaxi.decodeTicketId({ ticket: ticketResponse.body.response.ticket }),
          }),
        });
        bodies.push(JSON.stringify(completeResponse.body));

        for (const response of [
          await helpers.bankDataProviders.listUserConnections(),
          await helpers.bankDataProviders.getConnectionDetails({ connectionId }),
          await helpers.bankDataProviders.listExternalAccounts({ connectionId }),
          await helpers.bankDataProviders.getSupportedBankProviders(),
        ]) {
          bodies.push(JSON.stringify(response.body));
        }

        for (const body of bodies) {
          expect(body).not.toContain(MOCK_YAXI_KEY.secret);
          expect(body).not.toContain(connectionData);
        }
        const stored = JSON.stringify((await getConnection({ connectionId })).credentials);
        expect(stored).not.toContain(MOCK_YAXI_KEY.secret);
        expect(stored).not.toContain(connectionData);
      });
    });

    describe('Replacing the key', () => {
      const NEW_KEY = {
        keyId: 'api-key-integration-11111111-1111-4111-8111-111111111111',
        secret: Buffer.from('another-yaxi-secret-another-yaxi').toString('base64'),
      };

      it('stores a valid new key, keeps the connection data and returns no secret', async () => {
        const { connectionId } = await connectAccount();
        const { connectionData } = (await getConnection({ connectionId })).getDecryptedCredentials();

        mockYaxiBank.key = NEW_KEY;
        const response = await helpers.bankDataProviders.updateConnectionDetails({
          connectionId,
          credentials: NEW_KEY,
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.stringify(response.body)).not.toContain(NEW_KEY.secret);
        expect((await getConnection({ connectionId })).getDecryptedCredentials()).toEqual({
          ...NEW_KEY,
          connectionData,
        });
      });

      it('leaves stored credentials unchanged when YAXI rejects the new key', async () => {
        const { connectionId } = await connectAccount();
        const { credentials } = await getConnection({ connectionId });

        const response = await helpers.bankDataProviders.updateConnectionDetails({
          connectionId,
          credentials: NEW_KEY,
        });

        expect(response.statusCode).toBe(ERROR_CODES.Forbidden);
        expect(errorMessage({ response })).toBe(t({ key: 'bankDataProviders.yaxi.invalidKey' }));
        expect((await getConnection({ connectionId })).credentials).toBe(credentials);
      });
    });

    describe('Accounts', () => {
      it('lists accounts with a stable ID and the booked balance, skipping those without an IBAN', async () => {
        mockYaxiBank.accounts.push({ currency: 'EUR', name: 'Credit card' });
        const { connectionId } = await helpers.yaxi.connectAndLogin();

        const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });

        expect(accounts).toHaveLength(1);
        expect(accounts[0]).toMatchObject({
          externalId: MOCK_YAXI_EXTERNAL_ID,
          name: 'Girokonto',
          balance: 1000.5,
          currency: 'EUR',
        });
      });

      it.each([
        ['no accounts', []],
        ['only accounts without an IBAN', [{ currency: 'EUR', name: 'Credit card' }]],
      ])('returns an empty list when the bank has %s', async (_, accounts) => {
        mockYaxiBank.accounts = accounts;
        const { connectionId } = await helpers.yaxi.connectAndLogin();

        const response = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });

        expect(response.accounts).toEqual([]);
      });

      it('forwards the PSU IP on a user-triggered call', async () => {
        const { connectionId } = await helpers.yaxi.connectAndLogin();

        await helpers.makeRequest({
          method: 'get',
          url: `/bank-data-providers/connections/${connectionId}/available-accounts`,
          // Express trusts loopback proxies, so supertest's X-Forwarded-For becomes req.ip.
          headers: { 'User-Agent': 'yaxi-e2e', 'X-Forwarded-For': '8.8.8.8' },
        });

        expect(mockYaxiBank.clientOptions.at(-1)!.userInSession).toBe('8.8.8.8');
      });

      it('imports the selected account with its balance', async () => {
        const { connectionId, accountId } = await connectAccount();

        const details = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
        expect(details.connection.accounts[0]).toMatchObject({
          id: accountId,
          externalId: MOCK_YAXI_EXTERNAL_ID,
          currentBalance: 1000.5,
          type: 'yaxi',
        });
      });
    });

    describe('Transaction sync', () => {
      it('maps booked rows and skips pending ones', async () => {
        mockYaxiBank.transactions = [
          row(),
          row({
            amount: { amount: '250.00', currency: 'EUR' },
            bookingDate: undefined,
            valueDate: daysAgo({ days: 2 }),
            creditor: { name: 'Test User' },
            debtor: { name: 'Employer' },
            remittanceInformation: ['Salary'],
          }),
          row({ status: 'PENDING', amount: { amount: '-99.00', currency: 'EUR' } }),
        ];

        await connectAccount();

        const transactions = await helpers.getTransactions({ raw: true });
        expect(transactions).toHaveLength(2);

        const expense = transactions.find((tx) => tx.transactionType === TRANSACTION_TYPES.expense)!;
        expect(expense).toMatchObject({ amount: 12.5, note: 'Flat white Card 1234' });

        const income = transactions.find((tx) => tx.transactionType === TRANSACTION_TYPES.income)!;
        expect(income).toMatchObject({ amount: 250, note: 'Salary' });
      });

      it('skips rows in another currency, comparing case-insensitively', async () => {
        mockYaxiBank.transactions = [
          row(),
          row({ amount: { amount: '-5.00', currency: 'eur' } }),
          row({ amount: { amount: '-9.00', currency: 'USD' } }),
        ];

        await connectAccount();

        const transactions = await helpers.getTransactions({ raw: true });
        expect(transactions.map((tx) => Number(tx.amount)).toSorted((a, b) => a - b)).toEqual([5, 12.5]);
      });

      it('merges a matching bank row into a planned expense, keeping its category', async () => {
        mockYaxiBank.transactions = [row({ amount: { amount: '-1.00', currency: 'EUR' } })];
        const { connectionId, accountId } = await connectAccount();

        const categories = await helpers.getCategoriesList();
        const categoryId = categories.find((category) => category.id !== global.DEFAULT_CATEGORY_ID)!.id;
        const [plan] = await helpers.createPlannedTransaction({
          payload: {
            accountId,
            amount: 12.5,
            time: addDays(startOfDay(new Date()), 2).toISOString(),
            categoryId,
          },
          raw: true,
        });

        mockYaxiBank.transactions = [
          row({ amount: { amount: '-1.00', currency: 'EUR' } }),
          row({ bookingDate: daysAgo({ days: 1 }) }),
        ];
        await syncConnection({ connectionId });

        const rows = await Transactions.findAll({ where: { accountId } });
        expect(rows).toHaveLength(2);
        expect(rows.find((tx) => tx.id === plan.id)).toMatchObject({ isPlanned: false, categoryId });
      });

      it('imports card rows the bank already moved past booked', async () => {
        mockYaxiBank.transactions = [
          row({ status: 'INVOICED' }),
          row({ status: 'PAID', amount: { amount: '-5.00', currency: 'EUR' } }),
        ];

        await connectAccount();

        expect(await helpers.getTransactions({ raw: true })).toHaveLength(2);
      });

      it('imports a settled row that only carries a transaction date', async () => {
        mockYaxiBank.transactions = [row({ bookingDate: undefined, transactionDate: daysAgo({ days: 2 }) })];

        await connectAccount();

        expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);
      });

      it('does not import a row twice when the bank adds its booking date later', async () => {
        mockYaxiBank.transactions = [row({ bookingDate: undefined, valueDate: daysAgo({ days: 2 }) })];
        const { connectionId } = await connectAccount();

        mockYaxiBank.transactions = [row({ bookingDate: daysAgo({ days: 1 }), valueDate: daysAgo({ days: 2 }) })];
        await syncConnection({ connectionId });

        expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);
      });

      it('names the original counterparty on a reversal, not the account holder', async () => {
        const payee = await helpers.createPayee({ payload: { name: 'Coffee Shop' }, raw: true });
        mockYaxiBank.transactions = [row({ amount: { amount: '30.00', currency: 'EUR' }, reversal: true })];

        const { accountId } = await connectAccount();

        const [transaction] = await Transactions.findAll({ where: { accountId } });
        expect(transaction).toMatchObject({ transactionType: TRANSACTION_TYPES.income, payeeId: payee.id });
      });

      it('retries with a shorter window on a bank that serves less than the 90 day limit', async () => {
        mockYaxiBank.earliestRangeFrom = daysAgo({ days: 31 });
        mockYaxiBank.transactions = [row()];

        const { accountId } = await connectAccount();

        expect(await accountStatus({ accountId })).toMatchObject({ status: 'completed' });
        expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);
      });

      it('asks for a new login when even the shorter window is refused', async () => {
        const { connectionId, accountId } = await connectAccount();

        mockYaxiBank.failTransactionsWith = new PeriodOutOfBoundsException();
        await syncConnection({ connectionId });

        expect(await accountStatus({ accountId })).toMatchObject({
          status: 'failed',
          error: t({ key: 'bankDataProviders.yaxi.reauthRequired' }),
        });
      });

      it('deactivates the connection after repeated refusals of the shorter window', async () => {
        const { connectionId } = await connectAccount();

        mockYaxiBank.failTransactionsWith = new PeriodOutOfBoundsException();
        await syncConnection({ connectionId });
        expect((await getConnection({ connectionId })).isActive).toBe(true);

        await syncConnection({ connectionId });

        const details = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
        expect(details.connection).toMatchObject({
          isActive: false,
          deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE,
        });

        const { connectionsNeedingReauth } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
        expect(connectionsNeedingReauth.map((connection) => connection.connectionId)).toContain(connectionId);
      });

      it('keeps syncing the other account after a per-account failure', async () => {
        mockYaxiBank.transactions = [row()];
        mockYaxiBank.beforeTransactions = ({ iban }) => {
          if (iban === SECOND_IBAN) throw new NotFoundException();
        };

        const { firstId, secondId } = await connectTwoAccounts();

        expect(await accountStatus({ accountId: firstId })).toMatchObject({ status: 'completed' });
        expect(await accountStatus({ accountId: secondId })).toMatchObject({ status: 'failed' });
        expect(await Transactions.count({ where: { accountId: firstId } })).toBe(1);
      });

      it('keeps the first account completed and sets lastSyncAt when the second hits a connection-wide failure', async () => {
        const { connectionId, firstId, secondId } = await connectTwoAccounts();
        await helpers.yaxi.waitForJobRemoval({ connectionId });
        const { lastSyncAt } = await getConnection({ connectionId });

        let calls = 0;
        mockYaxiBank.beforeTransactions = () => {
          calls += 1;
          if (calls === 2) throw new InterruptErrorException();
        };
        await syncConnection({ connectionId });

        const statuses = [await accountStatus({ accountId: firstId }), await accountStatus({ accountId: secondId })];
        expect(statuses.map((status) => status!.status).toSorted()).toEqual(['completed', 'failed']);
        expect((await getConnection({ connectionId })).lastSyncAt!.getTime()).toBeGreaterThan(
          lastSyncAt?.getTime() ?? 0,
        );
      });

      it('does not report a fresh sync when every account failed', async () => {
        const { connectionId, accountId } = await connectAccount();
        await helpers.yaxi.waitForJobRemoval({ connectionId });
        const { lastSyncAt } = await getConnection({ connectionId });

        mockYaxiBank.failTransactionsWith = new NotFoundException();
        await syncConnection({ connectionId });

        expect(await accountStatus({ accountId })).toMatchObject({ status: 'failed' });
        expect((await getConnection({ connectionId })).lastSyncAt).toEqual(lastSyncAt);
      });

      it('sends a ticket carrying the account and a range within the 90 day limit', async () => {
        await connectAccount();

        const ticket = mockYaxiBank.ticketPayloads.find((payload) => payload.service === 'Transactions')!;
        const { account, range } = ticket.data as { account: unknown; range: { from: string } };

        expect(account).toEqual({ iban: MOCK_YAXI_EXTERNAL_ID.split(':')[0], currency: 'EUR' });
        expect(differenceInCalendarDays(new Date(), new Date(range.from))).toBeLessThanOrEqual(90);
      });

      it('re-reads a 14 day overlap on the next sync without duplicating rows', async () => {
        mockYaxiBank.transactions = [row()];
        const { connectionId } = await connectAccount();
        expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);

        mockYaxiBank.ticketPayloads = [];
        mockYaxiBank.transactions = [
          row(),
          row({ amount: { amount: '-7.00', currency: 'EUR' }, bookingDate: daysAgo({ days: 1 }) }),
        ];
        await syncConnection({ connectionId });

        expect(await helpers.getTransactions({ raw: true })).toHaveLength(2);

        const ticket = mockYaxiBank.ticketPayloads.find((payload) => payload.service === 'Transactions')!;
        expect((ticket.data as { range: { from: string } }).range.from).toBe(daysAgo({ days: 3 + 14 }));
      });

      it('imports two identical purchases on one day, and only once', async () => {
        mockYaxiBank.transactions = [row(), row()];
        const { connectionId } = await connectAccount();
        expect(await helpers.getTransactions({ raw: true })).toHaveLength(2);

        await syncConnection({ connectionId });
        expect(await helpers.getTransactions({ raw: true })).toHaveLength(2);
      });

      it('imports the later copy when a second identical purchase shows up on a later sync', async () => {
        mockYaxiBank.transactions = [row()];
        const { connectionId } = await connectAccount();

        mockYaxiBank.transactions = [row(), row()];
        await syncConnection({ connectionId });

        expect(await helpers.getTransactions({ raw: true })).toHaveLength(2);
      });

      it('also syncs through the single-account path', async () => {
        const { connectionId, accountId } = await connectAccount();

        mockYaxiBank.transactions = [row()];
        await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

        expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);
      });

      it('does not duplicate rows and restores originalId after an unlink and relink', async () => {
        mockYaxiBank.transactions = [row()];
        const { connectionId, accountId } = await connectAccount();
        await helpers.yaxi.waitForJobRemoval({ connectionId });
        const [imported] = await Transactions.findAll({ where: { accountId } });
        expect(imported!.originalId).not.toBeNull();

        await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: true });
        expect((await Transactions.findByPk(imported!.id))!.originalId).toBeNull();

        await helpers.linkAccountToBankConnection({
          id: accountId,
          connectionId,
          externalAccountId: MOCK_YAXI_EXTERNAL_ID,
          raw: true,
        });
        await helpers.bankDataProviders.waitForAccountsSyncToSettle();

        const rows = await Transactions.findAll({ where: { accountId } });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.originalId).toBe(imported!.originalId);
      });

      it('persists every rotated connection data copy', async () => {
        mockYaxiBank.transactions = [row()];
        mockYaxiBank.rotate = true;

        const { connectionId } = await connectAccount();
        await syncConnection({ connectionId });
        expect(mockYaxiBank.rotations).toBeGreaterThan(0);

        // Only the newest copy is accepted upstream, so a lost rotation would have failed the sync.
        const { accounts } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
        expect(accounts.every((account) => account.status === 'completed')).toBe(true);

        const credentials = (await getConnection({ connectionId })).getDecryptedCredentials();
        expect(credentials.connectionData).toBe(mockYaxiBank.connectionData.toString('base64'));
      });

      it('keeps a rotated copy when the single-account sync transaction rolls back', async () => {
        const { connectionId, accountId } = await connectAccount();

        mockYaxiBank.rotate = true;
        mockYaxiBank.transactions = [row({ amount: { amount: 'not-a-number', currency: 'EUR' } })];
        const response = await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });
        expect(response.statusCode).toBe(ERROR_CODES.UnexpectedError);
        expect(mockYaxiBank.rotations).toBeGreaterThan(0);

        const credentials = (await getConnection({ connectionId })).getDecryptedCredentials();
        expect(credentials.connectionData).toBe(mockYaxiBank.connectionData.toString('base64'));
      });
    });

    describe('Linking an existing account', () => {
      it('saves rotated connection data during the link sync', async () => {
        const { connectionId, link } = await linkAccount();
        mockYaxiBank.rotate = true;

        expect((await link()).statusCode).toBe(200);
        expect(mockYaxiBank.rotations).toBeGreaterThan(0);

        const credentials = (await getConnection({ connectionId })).getDecryptedCredentials();
        expect(credentials.connectionData).toBe(mockYaxiBank.connectionData.toString('base64'));
      });

      it('counts an upstream auth failure during the link sync and rolls the link back', async () => {
        const { connectionId, link } = await linkAccount();
        mockYaxiBank.failTransactionsWith = new InterruptErrorException();

        expect((await link()).statusCode).toBe(ERROR_CODES.Forbidden);

        const { metadata } = await getConnection({ connectionId });
        expect((metadata as { consecutiveAuthFailures: number }).consecutiveAuthFailures).toBe(1);

        const details = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
        expect(details.connection.accounts).toEqual([]);
      });

      it('imports rows from the link day onwards, including one booked after the link', async () => {
        const today = new Date().toISOString().slice(0, 10);
        const { accountId, connectionId, link } = await linkAccount();

        const beforeLinkDay = row({ bookingDate: daysAgo({ days: 3 }) });
        const onLinkDay = row({ bookingDate: today, amount: { amount: '-5.00', currency: 'EUR' } });
        mockYaxiBank.transactions = [beforeLinkDay, onLinkDay];
        expect((await link()).statusCode).toBe(200);
        expect(await importedOriginalIds({ accountId })).toHaveLength(1);

        const afterLink = row({ bookingDate: today, amount: { amount: '-7.00', currency: 'EUR' } });
        mockYaxiBank.transactions = [beforeLinkDay, onLinkDay, afterLink];
        await syncConnection({ connectionId });

        const imported = await importedOriginalIds({ accountId });
        expect(imported.map((tx) => tx.amount.toNumber()).toSorted()).toEqual([5, 7]);

        const details = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
        expect(details.connection.accounts[0]).toMatchObject({ currentBalance: 1000.5 });
      });
    });

    describe('Errors', () => {
      it.each([
        ['interrupts', () => new InterruptErrorException()],
        ['rejected bank credentials', () => new InvalidCredentialsException()],
      ])('deactivates the connection after repeated %s so the UI can offer a reconnect', async (_, buildError) => {
        const { connectionId, accountId } = await connectAccount();

        mockYaxiBank.failWith = buildError();
        await syncConnection({ connectionId });

        expect(await accountStatus({ accountId })).toMatchObject({ status: 'failed' });
        expect((await getConnection({ connectionId })).isActive).toBe(true);

        await syncConnection({ connectionId });

        const details = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
        expect(details.connection).toMatchObject({
          isActive: false,
          deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE,
        });

        const { connectionsNeedingReauth } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
        expect(connectionsNeedingReauth.map((connection) => connection.connectionId)).toContain(connectionId);
      });

      it('fails the sync on the refresh limit with a clear message and keeps the connection', async () => {
        const { connectionId, accountId } = await connectAccount();

        mockYaxiBank.failWith = new AccessExceededException();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await syncConnection({ connectionId });
        }

        expect(await accountStatus({ accountId })).toMatchObject({
          status: 'failed',
          error: t({ key: 'bankDataProviders.yaxi.accessExceeded' }),
        });

        const connection = await getConnection({ connectionId });
        expect(connection.isActive).toBe(true);
        expect((connection.metadata as { consecutiveAuthFailures?: number }).consecutiveAuthFailures ?? 0).toBe(0);
      });

      it('stays active with the counter reset when a success falls between two auth failures', async () => {
        const { connectionId } = await connectAccount();

        mockYaxiBank.failWith = new InterruptErrorException();
        await syncConnection({ connectionId });
        expect(await authFailures({ connectionId })).toBe(1);

        mockYaxiBank.failWith = null;
        await syncConnection({ connectionId });
        expect(await authFailures({ connectionId })).toBe(0);

        mockYaxiBank.failWith = new InterruptErrorException();
        await syncConnection({ connectionId });

        expect(await authFailures({ connectionId })).toBe(1);
        expect((await getConnection({ connectionId })).isActive).toBe(true);
      });

      it.each([
        ['a request failure', () => new RequestException('down')],
        ['a canceled call', () => new CanceledException()],
      ])('does not count %s as an auth failure', async (_, buildError) => {
        const { connectionId, accountId } = await connectAccount();

        mockYaxiBank.failWith = buildError();
        await syncConnection({ connectionId });
        await syncConnection({ connectionId });

        expect(await accountStatus({ accountId })).toMatchObject({
          status: 'failed',
          error: t({ key: 'bankDataProviders.yaxi.unavailable' }),
        });
        expect(await authFailures({ connectionId })).toBe(0);
        expect((await getConnection({ connectionId })).isActive).toBe(true);
      });

      it('shows its own message when the bank blocks the service', async () => {
        const { connectionId, accountId } = await connectAccount();

        mockYaxiBank.failWith = new ServiceBlockedException();
        await syncConnection({ connectionId });

        expect(await accountStatus({ accountId })).toMatchObject({
          status: 'failed',
          error: t({ key: 'bankDataProviders.yaxi.serviceBlocked' }),
        });
      });

      it('deactivates the connection when YAXI keeps rejecting the stored connection data', async () => {
        const { connectionId } = await connectAccount();

        mockYaxiBank.connectionData = Buffer.from('copy-the-server-no-longer-knows');
        await syncConnection({ connectionId });
        await syncConnection({ connectionId });

        const details = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
        expect(details.connection).toMatchObject({
          isActive: false,
          deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE,
        });
      });

      it('reports the refresh limit on the single-account path as a retryable error', async () => {
        const { connectionId, accountId } = await connectAccount();

        mockYaxiBank.failWith = new AccessExceededException();
        const response = await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });

        expect(response.statusCode).toBe(ERROR_CODES.ServiceUnavailable);
        expect((response.body.response as unknown as { details: unknown }).details).toEqual({
          reason: 'access_exceeded',
        });
      });
    });

    describe('Reconnecting', () => {
      it('rejects a login that cannot see any linked account and changes nothing', async () => {
        const { connectionId } = await connectAccount();
        const { credentials } = await getConnection({ connectionId });

        mockYaxiBank.accounts = [{ iban: 'DE89370400440532013000', currency: 'EUR' }];
        const response = await helpers.yaxi.login({ connectionId });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(errorMessage({ response })).toBe(t({ key: 'bankDataProviders.yaxi.differentBankLogin' }));

        expect((await getConnection({ connectionId })).credentials).toBe(credentials);
      });

      it('restores an expired connection, keeping its accounts and not duplicating rows', async () => {
        mockYaxiBank.transactions = [row()];
        const { connectionId, accountId } = await connectAccount();

        mockYaxiBank.failWith = new InterruptErrorException();
        await syncConnection({ connectionId });
        await syncConnection({ connectionId });
        expect((await getConnection({ connectionId })).isActive).toBe(false);

        mockYaxiBank.failWith = null;
        mockYaxiBank.connectionData = Buffer.from('mock-connection-data-after-login');
        mockYaxiBank.transactions = [row(), row({ amount: { amount: '-7.00', currency: 'EUR' } })];

        const response = await helpers.yaxi.login({ connectionId });
        expect(response.statusCode).toBe(200);
        await helpers.bankDataProviders.waitForAccountsSyncToSettle();

        const details = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
        expect(details.connection).toMatchObject({ id: connectionId, isActive: true, deactivationReason: null });
        expect(details.connection.accounts.map((account) => account.id)).toEqual([accountId]);

        expect(await helpers.getTransactions({ raw: true })).toHaveLength(2);

        const { metadata } = await getConnection({ connectionId });
        expect((metadata as { consecutiveAuthFailures: number }).consecutiveAuthFailures).toBe(0);
      });
    });
  });
});
