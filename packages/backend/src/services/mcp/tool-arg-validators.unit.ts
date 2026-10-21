import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createGroup } from '@services/budget-plans/line-groups';
import { RateLimitService } from '@services/common/rate-limit.service';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { saveCurrencyRateSource } from '@services/currencies/rate-sources/save-rate-source.service';
import { bulkDelete } from '@services/transactions/bulk-delete';
import { createTransaction } from '@services/transactions/create-transaction';
import { resolveBulkTargetIds } from '@services/transactions/matching-transactions';
import { captureTools, makeExtra } from '@tests/helpers/mcp-tools';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/transactions/create-transaction', () => ({ createTransaction: jest.fn() }));
jest.mock('@services/transactions/bulk-delete', () => ({ bulkDelete: jest.fn() }));
jest.mock('@services/transactions/matching-transactions', () => ({
  getTransactionsSummary: jest.fn(),
  resolveBulkTargetIds: jest.fn(),
}));
jest.mock('@services/budget-plans/line-groups', () => ({ createGroup: jest.fn() }));
jest.mock('@services/currencies/rate-sources/save-rate-source.service', () => ({ saveCurrencyRateSource: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('@services/common/rate-limit.service', () => ({ RateLimitService: { checkRateLimit: jest.fn() } }));

import { TOOL_ARG_VALIDATORS } from './tool-arg-validators';
import { registerBulkDeleteTransactions, validateBulkDeleteTransactionsArgs } from './tools/bulk-delete-transactions';
import { registerCreateBudgetPlanGroup, validateCreateBudgetPlanGroupArgs } from './tools/create-budget-plan-group';
import { registerCreateTransaction, validateCreateTransactionArgs } from './tools/create-transaction';
import { registerSetCurrencyRateSource, validateSetCurrencyRateSourceArgs } from './tools/set-currency-rate-source';

const ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3d';
const OTHER_ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3e';
const PLAN_ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3f';

const DELETE = makeExtra({ scopes: ['finance:read', 'finance:write', 'finance:delete'] });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'], features: ['budget_plan'] as never });

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(isBaseCurrencyChangeLocked).mockResolvedValue(false);
  jest.mocked(RateLimitService.checkRateLimit).mockResolvedValue({ allowed: true });
});

/** The message a synchronous check throws, or `undefined` when it accepts the input. */
const refusal = ({ run }: { run: () => unknown }): string | undefined => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
};

/** The message the handler rejects with, or `undefined` when it runs through. */
const handlerRefusal = async ({
  register,
  args,
  extra,
}: {
  register: Parameters<typeof captureTools>[0]['register'];
  args: unknown;
  extra: ReturnType<typeof makeExtra>;
}): Promise<string | undefined> => {
  const tool = captureTools({ register })[0]!;
  try {
    await tool.handler(args, extra);
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
};

const transactionArgs = {
  accountId: ID,
  amount: 10,
  transactionType: TRANSACTION_TYPES.expense,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
};

describe('registry', () => {
  it('maps the four representative tools to the validators their files export', () => {
    expect(TOOL_ARG_VALIDATORS.create_transaction).toBe(validateCreateTransactionArgs);
    expect(TOOL_ARG_VALIDATORS.create_budget_plan_group).toBe(validateCreateBudgetPlanGroupArgs);
    expect(TOOL_ARG_VALIDATORS.set_currency_rate_source).toBe(validateSetCurrencyRateSourceArgs);
    expect(TOOL_ARG_VALIDATORS.bulk_delete_transactions).toBe(validateBulkDeleteTransactionsArgs);
  });
});

describe('validateCreateTransactionArgs', () => {
  it.each([
    {
      label: 'an original amount without its currency',
      args: { ...transactionArgs, originalAmount: 66.42 },
      message: /must be set, or cleared, together/,
    },
    {
      label: 'an original currency without its amount',
      args: { ...transactionArgs, originalCurrencyCode: 'PLN' },
      message: /must be set, or cleared, together/,
    },
    {
      label: 'an original-currency pair on a transfer',
      args: {
        ...transactionArgs,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAccountId: OTHER_ID,
        originalAmount: 66.42,
        originalCurrencyCode: 'PLN',
      },
      message: /cannot be added to transfer transactions/,
    },
    {
      label: 'a payee id together with a merchant name',
      args: { ...transactionArgs, payeeId: OTHER_ID, merchantName: 'Cafe' },
      message: /"payeeId" and "merchantName" cannot be used together/,
    },
  ])(
    'refuses $label with the message the handler gives, and the handler still refuses it',
    async ({ args, message }) => {
      expect(refusal({ run: () => validateCreateTransactionArgs({ args: args as never }) })).toMatch(message);

      const handlerMessage = await handlerRefusal({ register: registerCreateTransaction, args, extra: DELETE });
      expect(handlerMessage).toBe(refusal({ run: () => validateCreateTransactionArgs({ args: args as never }) }));
      expect(createTransaction).not.toHaveBeenCalled();
    },
  );

  it('accepts a complete original-currency pair on a plain transaction', () => {
    expect(() =>
      validateCreateTransactionArgs({
        args: { ...transactionArgs, originalAmount: 66.42, originalCurrencyCode: 'PLN' } as never,
      }),
    ).not.toThrow();
  });
});

describe('validateCreateBudgetPlanGroupArgs', () => {
  it('returns the plan id with the name the shared body schema trimmed', () => {
    expect(validateCreateBudgetPlanGroupArgs({ args: { planId: PLAN_ID, name: ' Fixed costs ' } as never })).toEqual({
      planId: PLAN_ID,
      name: 'Fixed costs',
    });
  });

  it('refuses a blank name with the handler message, and the handler still refuses it', async () => {
    const args = { planId: PLAN_ID, name: '   ' };
    const message = refusal({ run: () => validateCreateBudgetPlanGroupArgs({ args: args as never }) });

    expect(message).toBeDefined();
    expect(await handlerRefusal({ register: registerCreateBudgetPlanGroup, args, extra: WRITE })).toBe(message);
    expect(createGroup).not.toHaveBeenCalled();
  });
});

describe('validateSetCurrencyRateSourceArgs', () => {
  it('returns the code with the body the REST schema parsed, leaving out undefined fields', () => {
    expect(
      validateSetCurrencyRateSourceArgs({
        args: {
          code: 'USDT',
          rateSource: 'peg',
          config: { pegCurrency: 'USD', factor: 1.02 },
          logoUrl: undefined,
        } as never,
      }),
    ).toEqual({ code: 'USDT', body: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1.02 } } });
  });

  it.each([
    { label: 'a peg without its config', args: { code: 'USDT', rateSource: 'peg' } },
    {
      label: 'a source config that belongs to another source',
      args: { code: 'USDT', rateSource: 'peg', config: { coinId: 'tether' } },
    },
  ])('refuses $label with the handler message, and the handler still refuses it', async ({ args }) => {
    const message = refusal({ run: () => validateSetCurrencyRateSourceArgs({ args: args as never }) });

    expect(message).toBeDefined();
    expect(await handlerRefusal({ register: registerSetCurrencyRateSource, args, extra: WRITE })).toBe(message);
    expect(saveCurrencyRateSource).not.toHaveBeenCalled();
  });
});

describe('validateBulkDeleteTransactionsArgs', () => {
  it('refuses `filters: {}`, which would select every transaction the caller owns', async () => {
    const args = { filters: {} };
    const message = refusal({ run: () => validateBulkDeleteTransactionsArgs({ args: args as never }) });

    expect(message).toMatch(/Refusing to delete without a narrowing filter/);
    expect(await handlerRefusal({ register: registerBulkDeleteTransactions, args, extra: DELETE })).toBe(message);
    expect(resolveBulkTargetIds).not.toHaveBeenCalled();
    expect(bulkDelete).not.toHaveBeenCalled();
  });

  it('refuses `transactionIds` together with `excludedIds` through `parseBulkTarget`', async () => {
    const args = { transactionIds: [ID], excludedIds: [OTHER_ID] };
    const message = refusal({ run: () => validateBulkDeleteTransactionsArgs({ args: args as never }) });

    expect(message).toBe('"excludedIds" only applies together with "filters"');
    expect(await handlerRefusal({ register: registerBulkDeleteTransactions, args, extra: DELETE })).toBe(message);
    expect(resolveBulkTargetIds).not.toHaveBeenCalled();
  });

  it('returns the parsed target for explicit ids and for a narrowing filter', () => {
    expect(validateBulkDeleteTransactionsArgs({ args: { transactionIds: [ID] } as never })).toEqual({
      transactionIds: [ID],
      selection: undefined,
    });
    expect(
      validateBulkDeleteTransactionsArgs({ args: { filters: { accountIds: [ID] }, excludedIds: [OTHER_ID] } as never }),
    ).toMatchObject({ selection: { filters: { accountIds: [ID] }, excludedIds: [OTHER_ID] } });
  });
});
