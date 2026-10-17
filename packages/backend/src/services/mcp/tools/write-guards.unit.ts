import { USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { captureTools, makeExtra } from '@tests/helpers/mcp-tools';

// Blocks the real services, whose import chains build queues at module scope and
// would open Redis connections in a unit test.
jest.mock('@services/accounts.service', () => ({ updateAccount: jest.fn() }));
jest.mock('@services/tags/delete-tag', () => ({ deleteTag: jest.fn() }));
jest.mock('@services/transactions/create-transaction', () => ({ createTransaction: jest.fn() }));
jest.mock('@services/transaction-automations/preview', () => ({ previewAutomation: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { updateAccount } from '@services/accounts.service';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { deleteTag } from '@services/tags/delete-tag';
import { previewAutomation } from '@services/transaction-automations/preview';
import { createTransaction } from '@services/transactions/create-transaction';

import { registerArchiveAccount } from './archive-account';
import { registerCreateTransaction } from './create-transaction';
import { registerDeleteTag } from './delete-tag';
import { registerPreviewTransactionAutomation } from './preview-transaction-automation';

const ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3d';

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);

const WRITE_TOOLS = [
  {
    register: registerArchiveAccount,
    name: 'archive_account',
    args: { id: ID, archived: true },
    service: updateAccount,
    scopes: ['finance:read', 'finance:write'],
  },
  {
    register: registerDeleteTag,
    name: 'delete_tag',
    args: { id: ID },
    service: deleteTag,
    scopes: ['finance:read', 'finance:delete'],
  },
  {
    register: registerCreateTransaction,
    name: 'create_transaction',
    args: {
      accountId: ID,
      amount: 10,
      transactionType: 'expense',
      paymentType: 'cash',
      transferNature: 'not_transfer',
    },
    service: createTransaction,
    scopes: ['finance:read', 'finance:write'],
  },
];

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe.each(WRITE_TOOLS)('$name write guards', ({ register, name, args, service, scopes }) => {
  const tool = captureTools({ register }).find((candidate) => candidate.name === name)!;

  it('is refused while the base-currency lock is set, with the service not called', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler(args, makeExtra({ scopes }))).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused for a demo user, with the service not called', async () => {
    await expect(tool.handler(args, makeExtra({ scopes, role: USER_ROLES.demo }))).rejects.toThrow(/demo mode/);
    expect(service).not.toHaveBeenCalled();
  });

  it('is refused for a read-only user, with the service not called', async () => {
    await expect(tool.handler(args, makeExtra({ scopes, readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    expect(service).not.toHaveBeenCalled();
  });
});

describe('preview_transaction_automation lock', () => {
  const tool = captureTools({ register: registerPreviewTransactionAutomation })[0]!;
  const args = { conditions: { operator: 'and', rules: [] } };

  it('is refused while the base-currency lock is set, with the service not called', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler(args, makeExtra({ scopes: ['finance:read'], readOnly: true }))).rejects.toThrow(
      /currencies.baseCurrencyChangeInProgress/,
    );
    expect(previewAutomation).not.toHaveBeenCalled();
  });

  it('still works for a read-only user while the lock is free', async () => {
    jest.mocked(previewAutomation).mockResolvedValueOnce({ matchedCount: 0, scannedCount: 0, matches: [] } as never);

    await tool.handler(args, makeExtra({ scopes: ['finance:read'], readOnly: true }));

    expect(previewAutomation).toHaveBeenCalledTimes(1);
  });
});
