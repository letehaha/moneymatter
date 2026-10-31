import { createHmac, timingSafeEqual } from 'node:crypto';

export class AccessExceededException extends Error {}
export class CanceledException extends Error {}
export class InterruptErrorException extends Error {}
export class InvalidCredentialsException extends Error {}
export class NotFoundException extends Error {}
export class PeriodOutOfBoundsException extends Error {}
export class ProviderErrorException extends Error {}
export class RequestException extends Error {}
export class ResponseException extends Error {}
export class ServiceBlockedException extends Error {}
export class TicketException extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
export class UnauthorizedException extends Error {}
export class UnexpectedErrorException extends Error {}
export class UnexpectedValueException extends Error {}
export class UnsupportedProductException extends Error {}

export const AccountField = {
  Iban: 'IBAN',
  Name: 'NAME',
  DisplayName: 'DISPLAYNAME',
  OwnerName: 'OWNERNAME',
  Currency: 'CURRENCY',
  Type: 'TYPE',
};

export const UserInSession = { At: (ipAddress: string) => ipAddress };

export const MOCK_YAXI_KEY = {
  keyId: 'api-key-integration-00000000-0000-4000-8000-000000000000',
  secret: Buffer.from('mock-yaxi-secret-mock-yaxi-secret').toString('base64'),
};
export const MOCK_YAXI_IBAN = 'DE02120300000000202051';
export const MOCK_YAXI_EXTERNAL_ID = `${MOCK_YAXI_IBAN}:EUR`;

const initialState = () => ({
  key: MOCK_YAXI_KEY,
  accounts: [{ iban: MOCK_YAXI_IBAN, currency: 'EUR', name: 'Girokonto', ownerName: 'Test User', type: 'CURRENT' }] as {
    iban?: string;
    currency?: string;
    name?: string;
    ownerName?: string;
    type?: string;
  }[],
  balance: '1000.50',
  transactions: [] as Record<string, unknown>[],
  // Only the newest copy is accepted, so a lost rotation fails the next call.
  connectionData: Buffer.from('mock-connection-data-0'),
  rotate: false,
  rotations: 0,
  failWith: null as Error | null,
  failTransactionsWith: null as Error | null,
  beforeTransactions: null as ((params: { iban: string }) => void) | null,
  // Rows older than this need a fresh login, on banks serving less than the 90 day limit.
  earliestRangeFrom: null as string | null,
  ticketPayloads: [] as { service: string; id: string; data: unknown; exp: number }[],
  clientOptions: [] as { url: URL; userInSession?: string }[],
});

/** The bank behind the fake client. Tests set rows and failures here; it is reset before each test. */
export const mockYaxiBank = {
  ...initialState(),
  reset() {
    Object.assign(this, initialState());
  },
};

const verifyTicket = ({ ticket, service }: { ticket: string; service: string }) => {
  const [header, payload, signed] = ticket.split('.') as [string, string, string];
  const { kid } = JSON.parse(Buffer.from(header, 'base64url').toString());
  if (kid !== mockYaxiBank.key.keyId) throw new TicketException('Unknown key', 'UNKNOWN_KEY');

  const expected = createHmac('sha256', Buffer.from(mockYaxiBank.key.secret, 'base64'))
    .update(`${header}.${payload}`)
    .digest();
  const actual = Buffer.from(signed, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new TicketException('Bad signature', 'INVALID');
  }

  const { data, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (data.service !== service) throw new TicketException('Wrong service', 'MISMATCH');
  if (exp * 1000 > Date.now() + 15 * 60 * 1000) throw new TicketException('Too long', 'INVALID_LIFETIME');

  mockYaxiBank.ticketPayloads.push({ ...data, exp });
  return data;
};

const respond = <T>({ result, connectionData }: { result: T; connectionData: Uint8Array }) => {
  if (mockYaxiBank.failWith) throw mockYaxiBank.failWith;
  if (!Buffer.from(connectionData).equals(mockYaxiBank.connectionData)) {
    throw new UnexpectedValueException('Unknown connection data');
  }
  if (!mockYaxiBank.rotate) return { result };

  mockYaxiBank.rotations += 1;
  mockYaxiBank.connectionData = Buffer.from(`mock-connection-data-${mockYaxiBank.rotations}`);
  return { result, connectionData: new Uint8Array(mockYaxiBank.connectionData) };
};

export class RoutexRefreshClient {
  constructor(options: { url: URL; userInSession?: string }) {
    mockYaxiBank.clientOptions.push(options);
  }

  async search({ ticket }: { ticket: string }) {
    verifyTicket({ ticket, service: 'Accounts' });
    if (mockYaxiBank.failWith) throw mockYaxiBank.failWith;
    return [];
  }

  async accounts({ ticket, connectionData }: { ticket: string; connectionData: Uint8Array }) {
    verifyTicket({ ticket, service: 'Accounts' });
    return respond({ result: mockYaxiBank.accounts, connectionData });
  }

  async balances({
    ticket,
    connectionData,
    accounts,
  }: {
    ticket: string;
    connectionData: Uint8Array;
    accounts: { iban: string; currency?: string }[];
  }) {
    verifyTicket({ ticket, service: 'Balances' });
    return respond({
      result: {
        balances: accounts.map((account) => ({
          account,
          balances: [
            { amount: '1.00', currency: 'EUR', balanceType: 'AVAILABLE' },
            { amount: mockYaxiBank.balance, currency: 'EUR', balanceType: 'BOOKED' },
          ],
        })),
      },
      connectionData,
    });
  }

  async transactions({ ticket, connectionData }: { ticket: string; connectionData: Uint8Array }) {
    const { data } = verifyTicket({ ticket, service: 'Transactions' });
    if (!data?.range?.from) throw new TicketException('Missing range', 'INVALID');
    const isKnownAccount = mockYaxiBank.accounts.some((account) => account.iban === data.account?.iban);
    if (!isKnownAccount || !data.account?.currency) throw new NotFoundException();
    mockYaxiBank.beforeTransactions?.({ iban: data.account.iban });
    if (mockYaxiBank.failTransactionsWith) throw mockYaxiBank.failTransactionsWith;
    if (mockYaxiBank.earliestRangeFrom && data.range.from < mockYaxiBank.earliestRangeFrom) {
      throw new PeriodOutOfBoundsException();
    }

    return respond({ result: mockYaxiBank.transactions, connectionData });
  }
}
