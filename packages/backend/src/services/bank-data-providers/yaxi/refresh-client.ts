import { requestContext } from '@common/request-context';
import {
  AccountField,
  type AccountReference,
  RoutexRefreshClient,
  UserInSession,
  type NonInteractiveResponse,
} from 'routex-refresh-client';

export {
  AccessExceededException,
  CanceledException,
  InterruptErrorException,
  InvalidCredentialsException,
  NotFoundException,
  PeriodOutOfBoundsException,
  ProviderErrorException,
  RequestException,
  ResponseException,
  ServiceBlockedException,
  TicketException,
  UnauthorizedException,
  UnexpectedErrorException,
  UnexpectedValueException,
  UnsupportedProductException,
} from 'routex-refresh-client';
export type { Account, AccountReference, Balance, Transaction } from 'routex-refresh-client';

const INTEGRATION_KEY_PREFIX = 'api-key-integration-';
const INTEGRATION_URL = 'https://integration.yaxi.tech/';
const PRODUCTION_URL = 'https://api.yaxi.tech/';

const ACCOUNT_FIELDS = [
  AccountField.Iban,
  AccountField.Name,
  AccountField.DisplayName,
  AccountField.OwnerName,
  AccountField.Currency,
  AccountField.Type,
];

export const resolveYaxiApiUrl = ({ keyId }: { keyId: string }): string =>
  keyId.startsWith(INTEGRATION_KEY_PREFIX) ? INTEGRATION_URL : PRODUCTION_URL;

// A user in session lifts the bank's unattended-refresh limit, so user-triggered calls forward the PSU IP.
const createClient = ({ keyId }: { keyId: string }) => {
  const psu = requestContext.getContext()?.psu;

  return new RoutexRefreshClient({
    url: new URL(resolveYaxiApiUrl({ keyId })),
    userInSession: psu ? UserInSession.At(psu.ipAddress) : undefined,
  });
};

const decodeConnectionData = ({ connectionData }: { connectionData: string }) =>
  new Uint8Array(Buffer.from(connectionData, 'base64'));

const toRefreshResult = <T>({ result, connectionData }: NonInteractiveResponse<T>) => ({
  result,
  connectionData: connectionData ? Buffer.from(connectionData).toString('base64') : undefined,
});

interface RefreshCallParams {
  keyId: string;
  ticket: string;
  connectionData: string;
}

export const searchConnections = ({ keyId, ticket, term }: { keyId: string; ticket: string; term: string }) =>
  createClient({ keyId }).search({ ticket, filters: [{ term }], limit: 1 });

export const refreshAccounts = async ({ keyId, ticket, connectionData }: RefreshCallParams) =>
  toRefreshResult(
    await createClient({ keyId }).accounts({
      ticket,
      connectionData: decodeConnectionData({ connectionData }),
      fields: ACCOUNT_FIELDS,
    }),
  );

export const refreshBalances = async ({
  keyId,
  ticket,
  connectionData,
  accounts,
}: RefreshCallParams & { accounts: AccountReference[] }) =>
  toRefreshResult(
    await createClient({ keyId }).balances({
      ticket,
      connectionData: decodeConnectionData({ connectionData }),
      accounts,
    }),
  );

export const refreshTransactions = async ({ keyId, ticket, connectionData }: RefreshCallParams) =>
  toRefreshResult(
    await createClient({ keyId }).transactions({
      ticket,
      connectionData: decodeConnectionData({ connectionData }),
    }),
  );
