import { TRANSACTION_TYPES, type OfxParseResult } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const readOfxUpload = jest.fn<() => Promise<OfxParseResult>>();
const findTransactions = jest.fn<() => Promise<FakeTransaction[]>>();
const findWithFilters = jest.fn<() => Promise<FakeTransaction[]>>();

jest.mock('./upload-cache', () => ({ readOfxUpload: () => readOfxUpload() }));
jest.mock('@models/transactions-query', () => ({ findTransactions: () => findTransactions() }));
jest.mock('@models/transactions.model', () => ({
  __esModule: true,
  findWithFilters: () => findWithFilters(),
}));

// eslint-disable-next-line import/first
import { detectOfxDuplicates } from './detect-duplicates.service';

interface FakeTransaction {
  id: string;
  accountId: string;
  originalId: string | null;
  time: string;
  amount: { toCents: () => number };
  transactionType: TRANSACTION_TYPES;
  note: string;
}

const ACCOUNT_ID = generateRandomRecordId();
const SOURCE_ACCOUNT_KEY = 'source-account';

function transaction({
  accountId = ACCOUNT_ID,
  originalId = null,
  type = TRANSACTION_TYPES.expense,
}: {
  accountId?: string;
  originalId?: string | null;
  type?: TRANSACTION_TYPES;
}): FakeTransaction {
  return {
    id: generateRandomRecordId(),
    accountId,
    originalId,
    time: '2026-08-01T09:00:00.000Z',
    amount: { toCents: () => 500 },
    transactionType: type,
    note: 'Stored note',
  };
}

function parsedResult({ originalId }: { originalId?: string }): OfxParseResult {
  return {
    accounts: [
      {
        sourceAccountKey: SOURCE_ACCOUNT_KEY,
        maskedDisplayName: 'Checking ••••1234',
        suggestedLocalName: 'Checking',
        statementType: 'bank',
        accountType: 'CHECKING',
        currency: 'USD',
        transactionCount: 1,
        netImportedAmount: '-5',
      },
    ],
    transactions: [
      {
        rowIndex: 0,
        sourceAccountKey: SOURCE_ACCOUNT_KEY,
        sourceTransactionKey: originalId,
        date: '2026-08-01T16:00:00.000Z',
        amount: '-5',
        type: TRANSACTION_TYPES.expense,
        payeeName: 'Example',
        note: 'Imported note',
        transactionType: 'DEBIT',
      },
    ],
    warnings: [],
    dateRange: { from: '2026-08-01T16:00:00.000Z', to: '2026-08-01T16:00:00.000Z' },
    formatVersion: '2.x',
    financialInstitutionName: 'Example Bank',
  };
}

async function detect() {
  return detectOfxDuplicates({
    userId: 1,
    uploadId: generateRandomRecordId(),
    accountMapping: { [SOURCE_ACCOUNT_KEY]: { action: 'link-existing', accountId: ACCOUNT_ID } },
  });
}

describe('detectOfxDuplicates', () => {
  beforeEach(() => {
    readOfxUpload.mockReset();
    findTransactions.mockReset();
    findTransactions.mockResolvedValue([]);
    findWithFilters.mockReset();
    findWithFilters.mockResolvedValue([]);
  });

  it('matches a FITID-derived originalId with full confidence', async () => {
    readOfxUpload.mockResolvedValue(parsedResult({ originalId: 'fitid-hash' }));
    const existing = transaction({ originalId: 'fitid-hash' });
    findTransactions.mockResolvedValue([
      transaction({ accountId: generateRandomRecordId(), originalId: 'fitid-hash' }),
      existing,
    ]);

    const result = await detect();

    expect(result.duplicates).toEqual([
      expect.objectContaining({
        rowIndex: 0,
        matchType: 'originalId',
        confidence: 100,
        existingTransaction: expect.objectContaining({ id: existing.id }),
      }),
    ]);
    expect(findWithFilters).not.toHaveBeenCalled();
  });

  it('does not apply fallback matching to a new FITID', async () => {
    readOfxUpload.mockResolvedValue(parsedResult({ originalId: 'new-fitid-hash' }));

    const result = await detect();

    expect(result.duplicates).toEqual([]);
    expect(findWithFilters).not.toHaveBeenCalled();
  });

  it('uses account, day, amount, and type for a FITID-less row', async () => {
    readOfxUpload.mockResolvedValue(parsedResult({}));
    const oppositeType = transaction({ type: TRANSACTION_TYPES.income });
    const matching = transaction({ type: TRANSACTION_TYPES.expense });
    findWithFilters.mockResolvedValue([oppositeType, matching]);

    const result = await detect();

    expect(result.duplicates).toEqual([
      expect.objectContaining({
        matchType: 'exact',
        confidence: 100,
        existingTransaction: expect.objectContaining({ id: matching.id }),
      }),
    ]);
    expect(findTransactions).not.toHaveBeenCalled();
  });
});
