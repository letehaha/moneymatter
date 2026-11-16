import { faker } from '@faker-js/faker';
import type { ReferenceNumber } from '@services/bank-data-providers/enablebanking/types/common';
import type { TransactionStatus } from '@services/bank-data-providers/enablebanking/types/enums';

/**
 * Mock Enable Banking test data
 */

export const MOCK_ENABLE_BANKING_APP_ID = 'test-app-id-12345';
// Valid test RSA private key (2048-bit, for testing only - DO NOT USE IN PRODUCTION)
export const MOCK_ENABLE_BANKING_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCr5KrR6mAOqASp
VS6dkfTjuEuaBI/aMSOVhTQzklBEiUdHGDiPHOYjLuc+LanLFNw45iHf4eSE8xH3
gJsNLY/9Mv25BhHcQH4AUc3Q1ZYfcAXb8+Q+4T4LBtAirR3P7EU2S46hNPpckyqE
cytjxuUeNlsuc0b6EKP3l+ltetsZVNnjvPM+6kqQOgNeI+R/hwhhmg1/ZfKRKHl5
q++QpoI/iiO27unzC0qQhrq6uk9oGsseIRrTlBXkuz8ddr053Q6/DnjJtsRDN7Hh
tn/bCXX4XVtHR72buuFMoC1qhNGUyuvvsK528oSCM51lPoXXzFza1Hb7w6ve2kvU
7MGE0qHBAgMBAAECgf8iF9GIjcMiTBkIuadHcDD+YbdtQnPdkuxTvLc0nWUgrFIa
ocn50QxjdrttO1VoOtG80nMXcWCoTALY3wmtsuWEWDPeeV1QawUMPRNb0LMGHu2M
vpL0QOpruHF327T7lFML6jgf3W4L30uZTjXL1pbeOrN9yY0F/PJUfNsAWKINBXcQ
Xirkr+skr2rNFxvrWVBViqMg8sBIst8krREU7DtMVcQ7G7rwFxUOBG95jguu5gnl
aKs8Ek92YO0z9vKg4qBbbhBk4a/O9vf8qCA7eaDZcxUZKjaJClsmhq7xYQoPVEZy
kuxaB3/l5okwn/QVDlsZ5xfD0hJxG8zDOf6OUZ0CgYEA5JtXeuByAaHrCXmJYi/E
qkuvh07VnhQMvxwoh9CZ0dJBHf3DI+GzOWUAkh6XxFcVhyNKuH8JDGTPZ3paoaB4
HWnm5xQC2HJl06ji4EtF4DehVaad3MLw8PbL6d/sHrcQ7UVrIicSAlLkIymk+Nfv
yr5omwZBS3lyvUn3edL3r+0CgYEAwH2Z0aJOKh/s/yyrBvlMlu4Tbibcb1jO449/
p5wKbPUe6K2lZoK1IeS25UpBHkH9Sg6AC+VZ6J7zFr1b0rUMJwlJQEME+Rtnz3fr
/FOALjDipjYogvhIVuaKxwqHA5Yow3BC3ePjZQxJS2rr9B/WblMXHUbkd45CeANA
bGeTdqUCgYEAkdzsPGLpW1FM/oaluhhwi5gvL06Fzo9McsQsuDvJaa+WDOTVlhd0
m7JuYs1SWNyXx9ok2wNzao0IKSZQncAd4+amhdqm1iRoBF1GJYbh1uan8laVcz6P
LbDK+zb9GbwE+N/KM8hqHUF2f1kbAgwF3H8Rj5i2IMolA9ImLX0GvSECgYBvKtqf
6EWOLHv57vkjAO1LqVlNX2IlaDurzp8h1Its26+rH0YLyucDGQzLpTOwXtoCYBdx
R1bCcrHfayLRsL/A96r3Uv1XRI2SkyaVxj+b7Z2n8lU5NlzI20JAq4LH/nuyS25C
qa8VF6BozupQRebYNmJ+BQhDR8R5fR9CvBq9BQKBgQDE8rVpk3H1DqK+k0zA9LCi
+9Y8pGQROWlTEuEBWaXzmve0se+3HtjAo8Ev+aW5UVZKrasRkQ/YJpacJynOuaho
9QZPH6+DGd6HR5neh7ASyXrHWkLtnmKK3qf+paEUfsPHIX+VulZ7umYmghWnWIUV
SwWGCgCtcUKMwXLQICWZww==
-----END PRIVATE KEY-----`;

export const INVALID_ENABLE_BANKING_APP_ID = 'invalid-app-id';
export const INVALID_ENABLE_BANKING_PRIVATE_KEY = 'not-a-valid-key';

// Mock bank details
export const MOCK_BANK_NAME = 'Nordea';
export const MOCK_BANK_COUNTRY = 'FI';
export const MOCK_BANK_BIC = 'NDEAFIHH';

// Mock OAuth state and codes
export const MOCK_AUTHORIZATION_ID = 'auth_1234567890abcdef';
export const MOCK_AUTH_CODE = 'oauth_code_abc123xyz789';
export const MOCK_SESSION_ID = 'session_9876543210fedcba';

// Mock account IDs (initial connection)
export const MOCK_ACCOUNT_UID_1 = 'account_eb_001';
export const MOCK_ACCOUNT_UID_2 = 'account_eb_002';
export const MOCK_ACCOUNT_UID_3 = 'account_eb_003';

// Mock account IDs after reconnection (new UUIDs, same IBANs)
// Enable Banking assigns new UUIDs after each reauthorization
export const MOCK_ACCOUNT_UID_1_RECONNECTED = 'account_eb_001_reconnected';
export const MOCK_ACCOUNT_UID_2_RECONNECTED = 'account_eb_002_reconnected';
export const MOCK_ACCOUNT_UID_3_RECONNECTED = 'account_eb_003_reconnected';

// Mock identification_hash - stable across sessions (unlike uid)
// This is a base64 encoded hash of account identifiers
export const MOCK_IDENTIFICATION_HASH_1 = 'aGFzaF9hY2NvdW50XzE='; // hash_account_1
export const MOCK_IDENTIFICATION_HASH_2 = 'aGFzaF9hY2NvdW50XzI='; // hash_account_2
export const MOCK_IDENTIFICATION_HASH_3 = 'aGFzaF9hY2NvdW50XzM='; // hash_account_3

// Second session ID for reconnection
export const MOCK_SESSION_ID_RECONNECTED = 'session_reconnected_abc123';

// Stand-in counterparty IBAN for fixed transactions that don't name one.
const DEFAULT_COUNTERPARTY_IBAN = 'FI0000000000000000';

/**
 * Generate mock ASPSP (bank) data
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getMockedASPSPData = (overrides?: Partial<any>) => {
  return [
    {
      name: MOCK_BANK_NAME,
      country: MOCK_BANK_COUNTRY,
      bic: MOCK_BANK_BIC,
      logo: 'https://example.com/nordea-logo.png',
      supported_account_schemes: ['IBAN'],
      supported_payment_types: ['SEPA'],
      identification_codes: ['NDEAFIHH'],
      bank_code: 'NORDEA',
      max_access_valid_for_days: 90,
      ...overrides,
    },
    {
      name: 'Revolut',
      country: 'GB',
      bic: 'REVOGB21',
      logo: 'https://example.com/revolut-logo.png',
      supported_account_schemes: ['IBAN', 'SORTCODE'],
      supported_payment_types: ['SEPA', 'INSTANT_SEPA'],
      identification_codes: ['REVOGB21'],
      bank_code: 'REVOLUT',
      max_access_valid_for_days: 90,
    },
  ];
};

/**
 * Generate mock account details
 * Handles both original and reconnected UIDs - reconnected UIDs return same IBAN but new UID
 * identification_hash is stable across sessions (same for original and reconnected)
 */
export const getMockedAccountDetails = (accountId: string) => {
  // Base account data (keyed by original UID)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseAccounts: Record<string, any> = {
    [MOCK_ACCOUNT_UID_1]: {
      name: 'Main Account',
      currency: 'EUR',
      account_id: {
        iban: 'FI1234567890123456',
      },
      product: 'Current Account',
      details: 'Personal account',
      account_servicer: {
        name: MOCK_BANK_NAME,
        bic_fi: MOCK_BANK_BIC,
      },
      identification_hash: MOCK_IDENTIFICATION_HASH_1,
    },
    [MOCK_ACCOUNT_UID_2]: {
      name: 'Savings Account',
      currency: 'EUR',
      account_id: {
        iban: 'FI9876543210987654',
      },
      product: 'Savings Account',
      details: 'Personal savings',
      credit_limit: { amount: '1500.00', currency: 'EUR' },
      account_servicer: {
        name: MOCK_BANK_NAME,
        bic_fi: MOCK_BANK_BIC,
      },
      identification_hash: MOCK_IDENTIFICATION_HASH_2,
    },
    [MOCK_ACCOUNT_UID_3]: {
      name: 'Business Account',
      currency: 'USD',
      account_id: {
        iban: 'FI1111222233334444',
      },
      product: 'Business Account',
      details: 'Business expenses',
      credit_limit: { amount: 'N/A', currency: 'USD' },
      account_servicer: {
        name: MOCK_BANK_NAME,
        bic_fi: MOCK_BANK_BIC,
      },
      identification_hash: MOCK_IDENTIFICATION_HASH_3,
    },
  };

  // Map reconnected UID to original for data lookup
  const reconnectedToOriginal: Record<string, string> = {
    [MOCK_ACCOUNT_UID_1_RECONNECTED]: MOCK_ACCOUNT_UID_1,
    [MOCK_ACCOUNT_UID_2_RECONNECTED]: MOCK_ACCOUNT_UID_2,
    [MOCK_ACCOUNT_UID_3_RECONNECTED]: MOCK_ACCOUNT_UID_3,
  };

  // Determine which base data to use
  const originalUid = reconnectedToOriginal[accountId] || accountId;
  const baseData = baseAccounts[originalUid] || baseAccounts[MOCK_ACCOUNT_UID_1];

  // Return with the requested UID (original or reconnected)
  // identification_hash stays the same (stable across sessions)
  return {
    ...baseData,
    uid: accountId,
  };
};

/**
 * Generate mock account balances
 * Handles both original and reconnected UIDs
 */
export const getMockedAccountBalances = (accountId: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balances: Record<string, any[]> = {
    [MOCK_ACCOUNT_UID_1]: [
      {
        balance_type: 'ITAV', // Interim Available
        balance_amount: {
          amount: '1523.45',
          currency: 'EUR',
        },
        reference_date: new Date().toISOString().split('T')[0],
      },
      {
        balance_type: 'ITBD', // Interim Booked
        balance_amount: {
          amount: '1523.45',
          currency: 'EUR',
        },
        reference_date: new Date().toISOString().split('T')[0],
      },
    ],
    [MOCK_ACCOUNT_UID_2]: [
      {
        balance_type: 'ITAV',
        balance_amount: {
          amount: '5432.10',
          currency: 'EUR',
        },
        reference_date: new Date().toISOString().split('T')[0],
      },
    ],
    [MOCK_ACCOUNT_UID_3]: [
      {
        balance_type: 'ITAV',
        balance_amount: {
          amount: '789.50',
          currency: 'USD',
        },
        reference_date: new Date().toISOString().split('T')[0],
      },
    ],
  };

  // Map reconnected UID to original for data lookup
  const reconnectedToOriginal: Record<string, string> = {
    [MOCK_ACCOUNT_UID_1_RECONNECTED]: MOCK_ACCOUNT_UID_1,
    [MOCK_ACCOUNT_UID_2_RECONNECTED]: MOCK_ACCOUNT_UID_2,
    [MOCK_ACCOUNT_UID_3_RECONNECTED]: MOCK_ACCOUNT_UID_3,
  };

  const originalUid = reconnectedToOriginal[accountId] || accountId;
  return balances[originalUid] || balances[MOCK_ACCOUNT_UID_1];
};

/**
 * Configuration for mock transaction data.
 * Controls whether transactions include all date fields or partial data.
 */
interface MockTransactionConfig {
  /** If true, only include booking_date (simulates initial sync) */
  partialDates: boolean;
  /** If provided, use these fixed transactions instead of generating new ones */
  fixedTransactions: FixedTransaction[] | null;
}

export interface FixedTransaction {
  /** Optional. Omit to simulate ASPSPs that don't return entry_reference initially. */
  entryReference?: string;
  amount: string;
  currency: string;
  isExpense: boolean;
  bookingDate?: string;
  valueDate?: string;
  transactionDate?: string;
  /**
   * Optional override for the counterparty IBAN (creditor IBAN if expense, debtor IBAN if income).
   * Defaults to a fixed placeholder. Use a stable per-tx value to make fingerprint matches work,
   * or `null` to omit the counterparty account entirely the way card purchases do.
   */
  counterpartyIban?: string | null;
  /** Counterparty identified by a domestic BBAN (e.g. a Swedish bankgiro) instead of an IBAN. */
  counterpartyBban?: string;
  /**
   * Overrides only the direction flag; the parties stay laid out by `isExpense`.
   * Mirrors ASPSPs that send a pending payload contradicting its own parties.
   */
  creditDebitIndicator?: 'CRDT' | 'DBIT';
  /** Optional override for remittance_information lines. */
  remittanceInformation?: string[];
  /** Enable Banking transaction status. Defaults to BOOK; use PDNG for pending card authorisations. */
  status?: `${TransactionStatus}`;
  /**
   * The bank's running balance after this transaction. Defaults to a fixed
   * placeholder; pass `null` for ASPSPs that omit it. Set a per-tx value to build
   * a day's balance ladder.
   */
  balanceAfter?: string | null;
  /** Structured creditor reference. A bare string mirrors ASPSPs that flatten the field. */
  referenceNumber?: ReferenceNumber | string;
}

let mockTransactionConfig: MockTransactionConfig = {
  partialDates: false,
  fixedTransactions: null,
};

/**
 * Set the mock transaction configuration.
 * Use this in tests to control transaction data behavior.
 */
export const setMockTransactionConfig = (config: Partial<MockTransactionConfig>) => {
  mockTransactionConfig = { ...mockTransactionConfig, ...config };
};

/**
 * Query params of the most recent GET /transactions call. The mock returns its
 * fixtures regardless of the range, so this is the only way a test can assert
 * which window the provider actually asked the bank for.
 */
type RecordedTransactionsQuery = { dateFrom: string | null; dateTo: string | null; strategy: string | null };

let lastTransactionsQuery: RecordedTransactionsQuery | null = null;

export const recordTransactionsQuery = ({ dateFrom, dateTo, strategy }: RecordedTransactionsQuery) => {
  lastTransactionsQuery = { dateFrom, dateTo, strategy };
};

export const getLastTransactionsQuery = () => lastTransactionsQuery;

/**
 * Reset mock transaction configuration to defaults.
 */
export const resetMockTransactionConfig = () => {
  mockTransactionConfig = {
    partialDates: false,
    fixedTransactions: null,
  };
  lastTransactionsQuery = null;
};

/**
 * Generate mock transactions for an account
 */
export const getMockedTransactions = (accountId: string, count: number = 10) => {
  // If fixed transactions are configured, use those
  if (mockTransactionConfig.fixedTransactions) {
    return mockTransactionConfig.fixedTransactions.map((ft, idx) => {
      const counterpartyIban = ft.counterpartyIban === null ? null : ft.counterpartyIban || DEFAULT_COUNTERPARTY_IBAN;
      const ownIban = getMockedAccountDetails(accountId).account_id.iban;
      const tx: Record<string, unknown> = {
        transaction_id: `tx_${accountId}_${ft.entryReference || `idx${idx}`}`,
        transaction_amount: {
          amount: ft.amount,
          currency: ft.currency,
        },
        credit_debit_indicator: ft.creditDebitIndicator ?? (ft.isExpense ? 'DBIT' : 'CRDT'),
        remittance_information: ft.remittanceInformation || ['Test transaction'],
        debtor: { name: ft.isExpense ? 'John Doe' : 'Test Company' },
        creditor: { name: ft.isExpense ? 'Test Company' : 'John Doe' },
        status: ft.status || 'BOOK',
      };

      if (ft.referenceNumber !== undefined) {
        tx.reference_number = ft.referenceNumber;
      }

      if (ft.balanceAfter !== null) {
        tx.balance_after_transaction = { amount: ft.balanceAfter ?? '1000.00', currency: ft.currency };
      }

      const ownAccountField = ft.isExpense ? 'debtor_account' : 'creditor_account';
      const counterpartyField = ft.isExpense ? 'creditor_account' : 'debtor_account';
      tx[ownAccountField] = { iban: ownIban };
      if (ft.counterpartyBban) {
        tx[counterpartyField] = { iban: null, other: { scheme_name: 'BBAN', identification: ft.counterpartyBban } };
      } else if (counterpartyIban) {
        tx[counterpartyField] = { iban: counterpartyIban };
      }

      // Only set entry_reference when provided — simulates ASPSPs that omit it.
      if (ft.entryReference !== undefined) {
        tx.entry_reference = ft.entryReference;
      }

      // Add optional date fields if present
      if (ft.bookingDate) {
        tx.booking_date = ft.bookingDate;
      }
      if (ft.valueDate) {
        tx.value_date = ft.valueDate;
      }
      if (ft.transactionDate) {
        tx.transaction_date = ft.transactionDate;
      }

      return tx;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactions: any[] = [];
  const today = new Date();

  for (let i = 0; i < count; i++) {
    const isExpense = i % 3 !== 0; // 2/3 expenses, 1/3 income
    const amount = faker.number.float({ min: 10, max: 500, fractionDigits: 2 });
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx: any = {
      transaction_id: `tx_${accountId}_${i}`,
      booking_date: date.toISOString().split('T')[0],
      transaction_amount: {
        amount: amount.toFixed(2),
        currency: accountId === MOCK_ACCOUNT_UID_3 ? 'USD' : 'EUR',
      },
      credit_debit_indicator: isExpense ? 'DBIT' : 'CRDT',
      remittance_information: [
        isExpense ? faker.company.name() : 'Salary payment',
        isExpense ? 'Payment for services' : 'Monthly income',
      ],
      debtor: isExpense
        ? {
            name: 'John Doe',
          }
        : {
            name: faker.company.name(),
          },
      debtor_account: isExpense
        ? {
            iban: getMockedAccountDetails(accountId).account_id.iban,
          }
        : {
            iban: `FI${faker.string.numeric(16)}`,
          },
      creditor: isExpense
        ? {
            name: faker.company.name(),
          }
        : {
            name: 'John Doe',
          },
      creditor_account: isExpense
        ? {
            iban: `FI${faker.string.numeric(16)}`,
          }
        : {
            iban: getMockedAccountDetails(accountId).account_id.iban,
          },
      entry_reference: `ref_${faker.string.alphanumeric(10)}`,
      // balance_after_transaction follows AmountType: { amount: string; currency: string }
      balance_after_transaction: {
        amount: faker.number.float({ min: 100, max: 2000, fractionDigits: 2 }).toFixed(2),
        currency: accountId === MOCK_ACCOUNT_UID_3 ? 'USD' : 'EUR',
      },
      status: 'BOOK',
    };

    // Add value_date only if not in partial dates mode
    if (!mockTransactionConfig.partialDates) {
      tx.value_date = date.toISOString().split('T')[0];
    }

    transactions.push(tx);
  }

  return transactions;
};

/**
 * Get all mock account UIDs (legacy - for getSession which returns just UIDs)
 */
export const getAllMockAccountUIDs = () => {
  return [MOCK_ACCOUNT_UID_1, MOCK_ACCOUNT_UID_2, MOCK_ACCOUNT_UID_3];
};

/**
 * Get all mock account UIDs for reconnected session (legacy - for getSession)
 * These are new UUIDs but will return same IBANs
 */
export const getAllMockAccountUIDsReconnected = () => {
  return [MOCK_ACCOUNT_UID_1_RECONNECTED, MOCK_ACCOUNT_UID_2_RECONNECTED, MOCK_ACCOUNT_UID_3_RECONNECTED];
};

/**
 * Get all mock accounts as full objects (for createSession response)
 * Enable Banking's POST /sessions returns full account objects, not just UIDs
 */
export const getAllMockAccounts = () => {
  return getAllMockAccountUIDs().map((uid) => getMockedAccountDetails(uid));
};

/**
 * Get all mock accounts as full objects for reconnected session
 * Returns new UIDs but same IBANs
 */
export const getAllMockAccountsReconnected = () => {
  return getAllMockAccountUIDsReconnected().map((uid) => getMockedAccountDetails(uid));
};

/**
 * Map reconnected UID to original UID for data lookup
 */
export const getOriginalUIDFromReconnected = (reconnectedUid: string): string => {
  const mapping: Record<string, string> = {
    [MOCK_ACCOUNT_UID_1_RECONNECTED]: MOCK_ACCOUNT_UID_1,
    [MOCK_ACCOUNT_UID_2_RECONNECTED]: MOCK_ACCOUNT_UID_2,
    [MOCK_ACCOUNT_UID_3_RECONNECTED]: MOCK_ACCOUNT_UID_3,
  };
  return mapping[reconnectedUid] || reconnectedUid;
};
