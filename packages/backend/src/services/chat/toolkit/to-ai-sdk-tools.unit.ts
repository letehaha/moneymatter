import { describe, expect, it, jest } from '@jest/globals';
import { makeChatRun, stubCatalog } from '@tests/helpers/chat-toolkit';

// The import chains of the services behind the catalog's tools open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));
jest.mock('../../mcp/auth', () => ({
  buildMcpAuthInfo: jest.fn(async () => ({
    token: '',
    clientId: 'moneymatter-chat',
    scopes: ['finance:read'],
    extra: { userId: 42 },
  })),
}));

import { buildChatToolkit } from './build-toolkit';
import { toAiSdkTools } from './to-ai-sdk-tools';

const build = () => {
  const { run } = makeChatRun();
  const toolkit = buildChatToolkit({ run, catalog: stubCatalog({ implementations: { get_categories: () => ['a'] } }) });
  return { toolkit, tools: toAiSdkTools({ toolkit }) as Record<string, any> };
};

describe('toAiSdkTools', () => {
  it('offers every tool of the toolkit under its name and description', () => {
    const { toolkit, tools } = build();

    expect(Object.keys(tools).toSorted()).toEqual(toolkit.tools.map((tool) => tool.name).toSorted());
    expect(tools.create_tag.description).toBe(toolkit.getTool({ name: 'create_tag' })!.description);
  });

  it('passes the toolkit model schema object itself, so the provider sees the ref-tolerant schema', () => {
    const { toolkit, tools } = build();

    for (const name of ['create_tag', 'get_categories', 'find_capabilities']) {
      expect([name, tools[name].inputSchema.jsonSchema === toolkit.getTool({ name })!.modelSchema]).toEqual([
        name,
        true,
      ]);
    }
  });

  it('only checks in the validate hook: the input comes back untouched, refs and _chat included', async () => {
    const { tools } = build();
    const input = {
      name: 'Coffee',
      color: '#aa0000',
      _chat: { uncertain: [{ field: 'color', reason: 'guessedFromHistory' }] },
    };

    const result = await tools.create_tag.inputSchema.validate(input);

    expect(result.success).toBe(true);
    expect(result.value).toBe(input);
  });

  it('fails the validate hook for an invalid input, with the reason as the error', async () => {
    const { tools } = build();

    const result = await tools.create_transaction.inputSchema.validate({
      accountId: '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11',
      amount: 1,
      transactionType: 'expense',
      paymentType: 'cash',
      transferNature: 'not_transfer',
      originalAmount: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/originalCurrencyCode/i);
  });

  it('executes through the toolkit with the call id the SDK supplies and returns the model text', async () => {
    const { toolkit, tools } = build();

    const output = await tools.get_categories.execute({}, { toolCallId: 'call-7', messages: [] });

    expect(output).toBe('["a"]');
    expect(toolkit.getReadResult({ callId: 'call-7' })).toBe('["a"]');
  });

  it('throws a tool error for a failed call, which the SDK shows the model', async () => {
    const { tools } = build();

    await expect(tools.get_account.execute({ accountId: 'nope' }, { toolCallId: 'c', messages: [] })).rejects.toThrow(
      /accountId/,
    );
  });
});
