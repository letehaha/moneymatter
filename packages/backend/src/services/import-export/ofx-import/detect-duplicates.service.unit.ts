import { TRANSACTION_TYPES, type OfxParseResult } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const readOfxUpload = jest.fn<() => Promise<OfxParseResult>>();
const getTransactionsByArrayOfField = jest.fn<() => Promise<FakeTransaction[]>>();
const findWithFilters = jest.fn<() => Promise<FakeTransaction[]>>();

jest.mock('./upload-cache', () => ({ readOfxUpload: () => readOfxUpload() }));
let mockAccountDecimals = 2;
jest.mock('@services/import-export/core/duplicates/get-account-decimals', () => ({
  __esModule: true,
  getAccountDecimals: ({ accountIds }: { accountIds: string[] }) =>
    Promise.resolve(new Map(accountIds.map((id) => [id, mockAccountDecimals]))),
}));
jest.mock('@models/transactions.model', () => ({
  __esModule: true,
  getTransactionsByArrayOfField: () => getTransactionsByArrayOfField(),
  findWithFilters: () => findWithFilters(),
}));

// eslint-disable-next-line import/first
import { detectOfxDuplicates } from './detect-duplicates.service';

interface FakeTransaction {
  id: string;
  accountId: string;
  originalId: string | null;
  time: string;
  amount: Money;
  transactionType: TRANSACTION_TYPES;
  note: string;
}

const ACCOUNT_ID = generateRandomRecordId();
const SOURCE_ACCOUNT_KEY = 'source-account';

function transaction({
  accountId = ACCOUNT_ID,
  originalId = null,
  type = TRANSACTION_TYPES.expense,
  amount = 5,
}: {
  accountId?: string;
  originalId?: string | null;
  type?: TRANSACTION_TYPES;
  amount?: number;
}): FakeTransaction {
  return {
    id: generateRandomRecordId(),
    accountId,
    originalId,
    time: '2026-08-01T09:00:00.000Z',
    amount: Money.fromDecimal(amount),
    transactionType: type,
    note: 'Stored note',
  };
}

function parsedResult({ originalId, amount = '-5' }: { originalId?: string; amount?: string }): OfxParseResult {
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
        netImportedAmount: amount,
      },
    ],
    transactions: [
      {
        rowIndex: 0,
        sourceAccountKey: SOURCE_ACCOUNT_KEY,
        sourceTransactionKey: originalId,
        date: '2026-08-01T16:00:00.000Z',
        amount,
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
    mockAccountDecimals = 2;
    readOfxUpload.mockReset();
    getTransactionsByArrayOfField.mockReset();
    getTransactionsByArrayOfField.mockResolvedValue([]);
    findWithFilters.mockReset();
    findWithFilters.mockResolvedValue([]);
  });

  it('matches a FITID-derived originalId with full confidence', async () => {
    readOfxUpload.mockResolvedValue(parsedResult({ originalId: 'fitid-hash' }));
    const existing = transaction({ originalId: 'fitid-hash' });
    getTransactionsByArrayOfField.mockResolvedValue([
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
    expect(getTransactionsByArrayOfField).not.toHaveBeenCalled();
  });

  it('keys a FITID-less row at the account currency decimals', async () => {
    mockAccountDecimals = 3;
    readOfxUpload.mockResolvedValue(parsedResult({ amount: '-1.2345' }));

    findWithFilters.mockResolvedValue([transaction({ amount: 1.231 })]);
    expect((await detect()).duplicates).toEqual([]);

    const matching = transaction({ amount: 1.235 });
    findWithFilters.mockResolvedValue([transaction({ amount: 1.231 }), matching]);
    expect((await detect()).duplicates).toEqual([
      expect.objectContaining({
        matchType: 'exact',
        existingTransaction: expect.objectContaining({ id: matching.id, amount: 1.235 }),
      }),
    ]);
  });
});
