import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';

// The import chains of the services behind the catalog's tools open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));

import { getToolCatalog, type ToolCatalogEntry } from '../../mcp/tool-catalog';
import { CHAT_META_FIELD, createInputValidator, getModelSchema, parseWriteInput } from './model-schema';
import type { JsonSchema } from './types';

const ACCOUNT = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const P1 = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const REF_PATTERN = '^\\$proposal:[0-9a-f-]{36}$';

const entryOf = ({ name }: { name: string }): ToolCatalogEntry => getToolCatalog().find((tool) => tool.name === name)!;
const writes = () => getToolCatalog().filter((tool) => tool.access === 'write');
const reads = () => getToolCatalog().filter((tool) => tool.access === 'read');

const transaction = (overrides: Record<string, unknown> = {}) => ({
  accountId: ACCOUNT,
  amount: 12.5,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: PAYMENT_TYPES.creditCard,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  ...overrides,
});

/** Every schema node of a JSON Schema tree, with the node that holds it. */
function* nodes({
  node,
  parent,
}: {
  node: unknown;
  parent?: unknown;
}): Generator<{ node: JsonSchema; parent: unknown }> {
  if (Array.isArray(node)) {
    for (const item of node) yield* nodes({ node: item, parent: node });
    return;
  }
  if (node === null || typeof node !== 'object') return;

  yield { node: node as JsonSchema, parent };
  for (const child of Object.values(node)) yield* nodes({ node: child, parent: node });
}

const isRefAlternative = ({ node }: { node: JsonSchema }) => node.type === 'string' && node.pattern === REF_PATTERN;
const isUuidAlternative = ({ node }: { node: JsonSchema }) => node.type === 'string' && node.format === 'uuid';

describe('getModelSchema', () => {
  it('shows every uuid position of every write tool as a plain string, which takes a ref as well', () => {
    for (const entry of writes()) {
      const { [CHAT_META_FIELD]: meta, ...ownProperties } = (
        getModelSchema({ entry }) as { properties: Record<string, unknown> }
      ).properties;
      expect(meta).toBeDefined();

      for (const { node } of nodes({ node: { properties: ownProperties } })) {
        // The ref alternative (and the uuid format it sits next to) cost tokens on every step of every run.
        expect([entry.name, isUuidAlternative({ node })]).toEqual([entry.name, false]);
        expect([entry.name, isRefAlternative({ node })]).toEqual([entry.name, false]);
        expect([entry.name, 'anyOf' in node && JSON.stringify(node).includes('$proposal')]).toEqual([
          entry.name,
          false,
        ]);
      }
    }
  });

  it('keeps an id field a string with its description, in arrays and nested objects too', () => {
    const schema = getModelSchema({ entry: entryOf({ name: 'create_transaction' }) }) as {
      properties: Record<string, any>;
    };

    expect(schema.properties.categoryId).toMatchObject({
      type: 'string',
      description: 'Category ID to assign to this transaction',
    });
    expect(schema.properties.tagIds.items).toMatchObject({ type: 'string' });
    expect(schema.properties.splits.items.properties.categoryId).toMatchObject({ type: 'string' });
    expect(schema.properties.note.anyOf).toBeUndefined();
  });

  it('adds the optional _chat meta field to write tools only', () => {
    for (const entry of writes()) {
      const schema = getModelSchema({ entry }) as { properties: Record<string, any>; required?: string[] };

      expect([entry.name, CHAT_META_FIELD in schema.properties]).toEqual([entry.name, true]);
      expect([entry.name, schema.required?.includes('_chat') ?? false]).toEqual([entry.name, false]);
    }
    for (const entry of reads()) {
      const schema = getModelSchema({ entry }) as { properties: Record<string, unknown> };

      expect([entry.name, CHAT_META_FIELD in schema.properties]).toEqual([entry.name, false]);
    }
  });

  it('describes the meta field with the closed uncertainty reasons', () => {
    const schema = getModelSchema({ entry: entryOf({ name: 'create_tag' }) }) as { properties: Record<string, any> };

    const meta = schema.properties[CHAT_META_FIELD];
    expect(meta.properties.uncertain.items.properties.reason.enum).toContain('guessedFromHistory');
    expect(meta.properties.replaces).toBeDefined();
    expect(meta.properties.sourceCallIds).toBeDefined();
  });

  it('leaves the uuid positions of a read tool as they are', () => {
    const schema = getModelSchema({ entry: entryOf({ name: 'get_account' }) });

    expect([...nodes({ node: schema })].some(({ node }) => isRefAlternative({ node }))).toBe(false);
    expect([...nodes({ node: schema })].some(({ node }) => isUuidAlternative({ node }))).toBe(true);
  });

  it('gives a tool with no input an empty object schema', () => {
    for (const name of ['get_categories', 'detect_subscription_candidates']) {
      const schema = getModelSchema({ entry: entryOf({ name }) }) as {
        type: string;
        properties: Record<string, unknown>;
      };

      expect([name, schema.type]).toEqual([name, 'object']);
      expect(Object.keys(schema.properties)).toEqual(name === 'get_categories' ? [] : [CHAT_META_FIELD]);
    }
  });

  it('serves the same object for the same tool, so a runner can pass it on by reference', () => {
    const entry = entryOf({ name: 'create_tag' });

    expect(getModelSchema({ entry })).toBe(getModelSchema({ entry }));
  });
});

describe('createInputValidator', () => {
  const validate = ({ name, input }: { name: string; input: unknown }) =>
    createInputValidator({ entry: entryOf({ name }) })({ input });

  it('answers a valid write input unchanged: refs and _chat stay in place', () => {
    const input: Record<string, any> = transaction({
      categoryId: `$proposal:${P1}`,
      _chat: { uncertain: [{ field: 'categoryId', reason: 'guessedFromHistory' }] },
    });

    const result = validate({ name: 'create_transaction', input });

    expect(result).toEqual({ success: true, value: input });
    expect(result.success && result.value).toBe(input);
    expect(input[CHAT_META_FIELD]).toBeDefined();
    expect(input.categoryId).toBe(`$proposal:${P1}`);
  });

  it('refuses a bad enum, a broken cross-field rule and a bulk delete with empty filters', () => {
    expect(validate({ name: 'create_transaction', input: transaction({ transactionType: 'sideways' }) }).success).toBe(
      false,
    );
    expect(validate({ name: 'create_transaction', input: transaction({ originalAmount: 10 }) }).success).toBe(false);
    expect(validate({ name: 'bulk_delete_transactions', input: { filters: {} } }).success).toBe(false);
  });

  it('refuses an uncertainty reason outside the enum and a field the tool does not take', () => {
    expect(
      validate({
        name: 'create_transaction',
        input: transaction({ _chat: { uncertain: [{ field: 'categoryId', reason: 'hunch' }] } }),
      }).success,
    ).toBe(false);
    expect(
      validate({
        name: 'create_transaction',
        input: transaction({ _chat: { uncertain: [{ field: 'nope', reason: 'other' }] } }),
      }).success,
    ).toBe(false);
  });

  it('gives the model the reason as the error message', () => {
    const result = validate({ name: 'create_transaction', input: transaction({ originalAmount: 10 }) });

    expect(result.success === false && result.error.message).toMatch(/originalCurrencyCode/i);
  });

  it('validates a read input with the tool schema and answers it unchanged', () => {
    const good = { accountId: ACCOUNT };
    const result = validate({ name: 'get_account', input: good });

    expect(result).toEqual({ success: true, value: good });
    expect(validate({ name: 'get_account', input: { accountId: 'nope' } }).success).toBe(false);
  });

  it('does not take a ref in a read tool', () => {
    expect(validate({ name: 'get_account', input: { accountId: `$proposal:${P1}` } }).success).toBe(false);
  });

  it('accepts an empty input for a tool with no input', () => {
    expect(validate({ name: 'get_categories', input: {} }).success).toBe(true);
  });
});

describe('parseWriteInput', () => {
  it('splits _chat from the arguments, keeps the refs and lists them', () => {
    const input = transaction({
      categoryId: `$proposal:${P1}`,
      _chat: { replaces: ACCOUNT, sourceCallIds: ['call-1'] },
    });

    const parsed = parseWriteInput({ entry: entryOf({ name: 'create_transaction' }), input });

    expect(parsed.args).toEqual(transaction({ categoryId: `$proposal:${P1}` }));
    expect(parsed.args).not.toHaveProperty('_chat');
    expect(parsed.meta).toEqual({ replaces: ACCOUNT, sourceCallIds: ['call-1'] });
    expect(parsed.refs).toEqual([P1]);
  });

  it('treats a missing _chat as an empty meta', () => {
    expect(
      parseWriteInput({ entry: entryOf({ name: 'create_tag' }), input: { name: 'a', color: '#fff' } }).meta,
    ).toEqual({});
  });
});
