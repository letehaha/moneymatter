import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';

// The import chains of the services behind the catalog's tools open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));

import { getToolCatalog, type ToolCatalogEntry } from '../../mcp/tool-catalog';
import { assertNoRefCycle, findProposalRefs, isProposalRef, ToolInputError, validateWithRefs } from './placeholders';

const ACCOUNT = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const P1 = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const P2 = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
const ref = ({ id }: { id: string }) => `$proposal:${id}`;

const entryOf = ({ name }: { name: string }): ToolCatalogEntry => getToolCatalog().find((tool) => tool.name === name)!;

const transaction = (overrides: Record<string, unknown> = {}) => ({
  accountId: ACCOUNT,
  amount: 12.5,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: PAYMENT_TYPES.creditCard,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  ...overrides,
});

describe('proposal refs', () => {
  it('recognises a ref by its exact form', () => {
    expect(isProposalRef({ value: ref({ id: P1 }) })).toBe(true);
    expect(isProposalRef({ value: '$proposal:abc' })).toBe(false);
    expect(isProposalRef({ value: ` ${ref({ id: P1 })}` })).toBe(false);
    expect(isProposalRef({ value: P1 })).toBe(false);
    expect(isProposalRef({ value: 5 })).toBe(false);
  });

  it('finds refs at any depth, once each, in order of appearance', () => {
    const args = {
      categoryId: ref({ id: P1 }),
      nested: { splits: [{ categoryId: ref({ id: P2 }) }, { categoryId: ref({ id: P1 }) }] },
      tagIds: [ACCOUNT, ref({ id: P2 })],
      note: 'plain',
    };

    expect(findProposalRefs({ value: args })).toEqual([P1, P2]);
    expect(findProposalRefs({ value: { a: 1 } })).toEqual([]);
  });
});

describe('validateWithRefs', () => {
  it('accepts a ref in a uuid position and in an array of ids, and reports the refs', () => {
    const args = transaction({ categoryId: ref({ id: P1 }), tagIds: [ref({ id: P2 })] });

    const result = validateWithRefs({ entry: entryOf({ name: 'create_transaction' }), args });

    expect(result.refs).toEqual([P1, P2]);
  });

  it('accepts a ref inside a shared body schema that parses the id', () => {
    expect(
      validateWithRefs({
        entry: entryOf({ name: 'create_account_group' }),
        args: { name: 'Savings', parentGroupId: ref({ id: P1 }) },
      }).refs,
    ).toEqual([P1]);
    expect(
      validateWithRefs({
        entry: entryOf({ name: 'create_holding' }),
        args: { portfolioId: ref({ id: P1 }), securityId: ACCOUNT },
      }).refs,
    ).toEqual([P1]);
  });

  it('keeps two different refs distinct, so a uniqueness rule still sees two ids', () => {
    expect(() =>
      validateWithRefs({
        entry: entryOf({ name: 'create_transaction' }),
        args: transaction({ tagIds: [ref({ id: P1 }), ref({ id: P2 })] }),
      }),
    ).not.toThrow();
  });

  it('refuses a malformed ref and a string that is no uuid', () => {
    const entry = entryOf({ name: 'create_transaction' });

    expect(() => validateWithRefs({ entry, args: transaction({ categoryId: '$proposal:abc' }) })).toThrow(
      ToolInputError,
    );
    expect(() => validateWithRefs({ entry, args: transaction({ categoryId: 'not-a-uuid' }) })).toThrow(ToolInputError);
  });

  it('runs validateArgs on the placeholder copy', () => {
    const entry = entryOf({ name: 'create_transaction' });

    expect(() => validateWithRefs({ entry, args: transaction({ originalAmount: 10 }) })).toThrow(
      /originalCurrencyCode/i,
    );
    expect(() =>
      validateWithRefs({ entry: entryOf({ name: 'bulk_delete_transactions' }), args: { filters: {} } }),
    ).toThrow(/narrowing filter/i);
  });

  it('names the failing field in a schema error', () => {
    expect(() =>
      validateWithRefs({
        entry: entryOf({ name: 'create_transaction' }),
        args: transaction({ transactionType: 'sideways' }),
      }),
    ).toThrow(/transactionType/);
  });

  it('leaves the arguments it was given unchanged', () => {
    const args = transaction({ categoryId: ref({ id: P1 }), tagIds: [ref({ id: P2 })] });
    const before = JSON.parse(JSON.stringify(args));

    validateWithRefs({ entry: entryOf({ name: 'create_transaction' }), args });

    expect(args).toEqual(before);
  });

  it('accepts an empty object for a tool with no input', () => {
    expect(validateWithRefs({ entry: entryOf({ name: 'detect_subscription_candidates' }), args: {} }).refs).toEqual([]);
  });
});

describe('assertNoRefCycle', () => {
  it('accepts a chain', () => {
    expect(() =>
      assertNoRefCycle({
        proposalId: 'c',
        refs: ['b'],
        dependsOnById: new Map([
          ['b', ['a']],
          ['a', []],
        ]),
      }),
    ).not.toThrow();
  });

  it('refuses a ref to the proposal itself', () => {
    expect(() => assertNoRefCycle({ proposalId: 'a', refs: ['a'], dependsOnById: new Map() })).toThrow(/cycle/i);
  });

  it('refuses a ref chain that leads back to the proposal', () => {
    expect(() =>
      assertNoRefCycle({
        proposalId: 'a',
        refs: ['b'],
        dependsOnById: new Map([
          ['b', ['c']],
          ['c', ['a']],
        ]),
      }),
    ).toThrow(/cycle/i);
  });
});
