import {
  CHAT_MAX_PROPOSALS,
  CHAT_MAX_THIRD_PARTY_READS,
  CHAT_MAX_TOOL_CALLS,
  CHAT_PROPOSAL_LIFETIME_MS,
  CHAT_READ_RESULT_MAX_CHARS,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type ChatRunEvent,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import ChatAttachments from '@models/chat-attachments.model';
import ChatProposals from '@models/chat-proposals.model';
import * as usersCurrencies from '@models/users-currencies.model';
import {
  CHAT_TEST_MESSAGE_ID,
  CHAT_TEST_THREAD_ID,
  CHAT_TEST_USER_ID,
  makeChatRun,
  stubCatalog,
} from '@tests/helpers/chat-toolkit';

// The import chains of the services behind the catalog's tools open Redis connections.
// The payment-type check reads the account's history from the database.
jest.mock('../proposals/account-history-guard', () => ({
  markAccountHistoryMismatch: jest.fn(async ({ uncertain }: { uncertain: unknown }) => uncertain),
}));
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
// The names of the records a card points at come from the database; these suites run without one.
jest.mock('../proposals/card-labels', () => ({ resolveCardLabels: jest.fn(async () => ({})) }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));
// Storing a card opens a transaction; a unit test has no database, so the body just runs.
jest.mock('@services/common/with-transaction', () => ({
  withTransaction: <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => fn,
}));
jest.mock('../../mcp/auth', () => ({ buildMcpAuthInfo: jest.fn() }));
jest.mock('../visuals/resolve-entity-labels', () => ({ resolveEntityLabels: jest.fn() }));

import { buildMcpAuthInfo } from '../../mcp/auth';
import { CHAT_CORE_TOOLS } from '../policies/core-tools';
import { isSafeForApproveAll } from '../policies/safe-cards';
import { PREVIEW_RESOLVERS } from '../proposals/previews';
import { resolveEntityLabels } from '../visuals/resolve-entity-labels';
import { buildChatToolkit } from './build-toolkit';
import { CHAT_CLIENT_ID } from './extras';
import { getModelSchema } from './model-schema';
import type { ChatToolkit } from './types';

const ACCOUNT = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const P1 = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const P2 = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
const OLD = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ATTACHMENT = 'f0e1d2c3-b4a5-4968-8776-655443322110';

const ref = ({ id }: { id: string }) => `$proposal:${id}`;

const createSpy = () => jest.mocked(ChatProposals.create);
const findAllSpy = () => jest.mocked(ChatProposals.findAll);

const transaction = (overrides: Record<string, unknown> = {}) => ({
  accountId: ACCOUNT,
  amount: 12.5,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: PAYMENT_TYPES.creditCard,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  ...overrides,
});

const tagInput = (overrides: Record<string, unknown> = {}) => ({ name: 'Coffee', color: '#aa0000', ...overrides });

const parentRow = ({
  id,
  toolName = 'create_category',
  status = 'pending',
}: {
  id: string;
  toolName?: string;
  status?: string;
}) => ({
  id,
  toolName,
  status,
  statusReason: null,
  revision: 1,
  userId: CHAT_TEST_USER_ID,
  threadId: CHAT_TEST_THREAD_ID,
  entity: toolName === 'create_tag' ? 'tag' : 'category',
  cardKind: 'create',
  args: toolName === 'create_tag' ? tagInput() : { name: 'Food' },
  danger: 'none',
  confirmation: 'none',
  confirmationPhrase: null,
  preview: null,
  uncertainFields: null,
  sources: [],
  dependsOn: [],
  editedFields: [],
  executedArgs: null,
  result: null,
  error: null,
  createdAt: new Date('2026-10-18T09:00:00.000Z'),
  expiresAt: new Date('2026-10-19T09:00:00.000Z'),
  appliedAt: null,
});

const setup = ({
  implementations,
  runOverrides,
}: {
  implementations?: Record<string, (args: unknown) => unknown>;
  runOverrides?: Parameters<typeof makeChatRun>[0];
} = {}) => {
  const { run, events } = makeChatRun(runOverrides);
  const catalog = stubCatalog({ implementations });
  const toolkit = buildChatToolkit({ run, catalog });
  const handler = ({ name }: { name: string }) =>
    catalog.find((entry) => entry.name === name)!.invoke as unknown as jest.Mock<
      (...args: unknown[]) => Promise<unknown>
    >;

  return { run, events, catalog, toolkit, handler };
};

const call = async ({
  toolkit,
  name,
  input = {},
  callId,
}: {
  toolkit: ChatToolkit;
  name: string;
  input?: unknown;
  callId?: string;
}) => {
  const tool = toolkit.getTool({ name });
  expect(tool).toBeDefined();
  return tool!.execute({ input, callId });
};

const cardsIn = ({ events }: { events: ChatRunEvent[] }) =>
  events.flatMap((event) => (event.type === 'proposal.upserted' ? [event.card] : []));

const noticesIn = ({ events }: { events: ChatRunEvent[] }) =>
  events.flatMap((event) => (event.type === 'part.started' && event.part.type === 'notice' ? [event.part] : []));

const toolCallEvents = ({ events }: { events: ChatRunEvent[] }) =>
  events.filter(
    (event) => (event.type === 'part.started' && event.part.type === 'toolCall') || event.type === 'part.updated',
  );

describe('buildChatToolkit', () => {
  beforeEach(() => {
    jest.mocked(buildMcpAuthInfo).mockReset();
    jest.mocked(buildMcpAuthInfo).mockImplementation((async ({ user, clientId, scopes, token }: any) => ({
      token,
      clientId,
      scopes,
      extra: {
        userId: user.id,
        authUserId: user.authUserId,
        username: user.username,
        role: user.role,
        readOnly: false,
        features: [],
      },
    })) as never);
    jest.mocked(resolveEntityLabels).mockReset();
    jest.mocked(resolveEntityLabels).mockImplementation((async ({ spec }: any) => ({ spec, foreign: [] })) as never);
    // The toolkit is tested against an empty registry; the real resolvers have their own suites.
    for (const key of Object.keys(PREVIEW_RESOLVERS)) delete (PREVIEW_RESOLVERS as Record<string, unknown>)[key];
    jest.spyOn(ChatProposals, 'create').mockImplementation((async (values: any) => ({
      ...values,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as never);
    jest.spyOn(ChatProposals, 'findAll').mockResolvedValue([]);
    jest.spyOn(ChatProposals, 'findOne').mockResolvedValue(null);
    jest.spyOn(ChatAttachments, 'findOne').mockResolvedValue(null);
    jest.spyOn(usersCurrencies, 'getBaseCurrency').mockResolvedValue({ currencyCode: 'USD' } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of Object.keys(PREVIEW_RESOLVERS)) delete (PREVIEW_RESOLVERS as Record<string, unknown>)[key];
  });

  describe('tools', () => {
    it('offers every capability and the chat-native tools, and none of the excluded ones', () => {
      const { toolkit, catalog } = setup();
      const names = new Set(toolkit.tools.map((tool) => tool.name));

      expect(names.size).toBe(toolkit.tools.length);
      expect(names.has('get_categories')).toBe(true);
      expect(names.has('create_transaction')).toBe(true);
      expect(names.has('create_attachment_upload_url')).toBe(false);
      for (const native of [
        'find_capabilities',
        'ask_clarification',
        'render_chart',
        'render_table',
        'render_kpis',
        'read_attachment',
        'run_analysis',
        'set_thread_title',
      ]) {
        expect([native, names.has(native)]).toEqual([native, true]);
      }
      expect(toolkit.tools.length).toBe(catalog.length - 2 + 8);
    });

    it('classifies a tool as a read, a write or a chat-native tool, with the model schema of the catalog', () => {
      const { toolkit, catalog } = setup();

      expect(toolkit.getTool({ name: 'get_categories' })?.kind).toBe('read');
      expect(toolkit.getTool({ name: 'create_tag' })?.kind).toBe('write');
      expect(toolkit.getTool({ name: 'find_capabilities' })?.kind).toBe('native');
      expect(toolkit.getTool({ name: 'create_tag' })?.modelSchema).toBe(
        getModelSchema({ entry: catalog.find((entry) => entry.name === 'create_tag')! }),
      );
    });

    it('starts with the core tools and the native tools active', () => {
      const { toolkit } = setup();
      const active = new Set(toolkit.activeToolNames());

      for (const name of CHAT_CORE_TOOLS) expect([name, active.has(name)]).toEqual([name, true]);
      expect(active.has('find_capabilities')).toBe(true);
      expect(active.has('ask_clarification')).toBe(true);
      expect(active.has('delete_account')).toBe(false);
    });
  });

  describe('reads', () => {
    it('runs a read through entry.invoke with read-only scopes and the chat client id', async () => {
      const { toolkit, handler } = setup({ implementations: { search_transactions: () => [{ id: 't1' }] } });

      const result = await call({ toolkit, name: 'search_transactions', input: { startDate: '2026-09-01' } });

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toEqual([{ id: 't1' }]);
      expect(buildMcpAuthInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({ id: CHAT_TEST_USER_ID }),
          clientId: CHAT_CLIENT_ID,
          scopes: ['finance:read'],
        }),
      );
      expect(handler({ name: 'search_transactions' })).toHaveBeenCalledWith({
        args: expect.objectContaining({ startDate: '2026-09-01' }),
        extra: { authInfo: expect.objectContaining({ clientId: CHAT_CLIENT_ID, scopes: ['finance:read'] }) },
      });
    });

    it('runs a tool registered without input', async () => {
      const { toolkit, handler } = setup({ implementations: { get_categories: () => [{ id: 'c1', name: 'Food' }] } });

      const result = await call({ toolkit, name: 'get_categories' });

      expect(JSON.parse(result.text)).toEqual([{ id: 'c1', name: 'Food' }]);
      expect(handler({ name: 'get_categories' })).toHaveBeenCalledTimes(1);
    });

    it('builds the auth info once per toolkit', async () => {
      const { toolkit } = setup();

      await call({ toolkit, name: 'get_categories' });
      await call({ toolkit, name: 'get_accounts' });

      expect(buildMcpAuthInfo).toHaveBeenCalledTimes(1);
    });

    it('caps the result the model sees at 40,000 characters and keeps the whole result for the run', async () => {
      const big = 'x'.repeat(100_000);
      const { toolkit } = setup({ implementations: { get_categories: () => big } });

      const result = await call({ toolkit, name: 'get_categories', callId: 'call-big' });

      expect(result.isError).toBe(false);
      expect(result.text.length).toBeLessThanOrEqual(CHAT_READ_RESULT_MAX_CHARS);
      expect(result.text).toMatch(/truncated/i);
      expect(toolkit.getReadResult({ callId: 'call-big' })).toBe(JSON.stringify(big));
      expect(toolkit.getReadResult({ callId: 'other' })).toBeNull();
    });

    it('leaves a result under the cap whole', async () => {
      const { toolkit } = setup({ implementations: { get_categories: () => ['a'] } });

      const result = await call({ toolkit, name: 'get_categories', callId: 'small' });

      expect(result.text).toBe(toolkit.getReadResult({ callId: 'small' }));
    });

    it('turns a handler error into a tool error and goes on', async () => {
      const { toolkit, handler } = setup();
      handler({ name: 'get_account' }).mockRejectedValueOnce(new Error('Account not found'));

      const result = await call({ toolkit, name: 'get_account', input: { accountId: ACCOUNT } });

      expect(result).toEqual({ isError: true, text: expect.stringContaining('Account not found') });
      await expect(call({ toolkit, name: 'get_categories' })).resolves.toMatchObject({ isError: false });
    });

    it('refuses arguments the tool schema rejects without calling the handler', async () => {
      const { toolkit, handler } = setup();

      const result = await call({ toolkit, name: 'get_account', input: { accountId: 'nope' } });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/accountId/);
      expect(handler({ name: 'get_account' })).not.toHaveBeenCalled();
    });

    it('wraps the model-facing text when the run asks for it', async () => {
      const wrapUntrusted = jest.fn(({ kind, text }: { kind: string; text: string }) => `[${kind}]${text}`);
      const { toolkit } = setup({ runOverrides: { wrapUntrusted }, implementations: { get_categories: () => ['a'] } });

      const result = await call({ toolkit, name: 'get_categories', callId: 'w' });

      expect(result.text).toBe('[toolResult]["a"]');
      expect(toolkit.getReadResult({ callId: 'w' })).toBe('["a"]');
    });

    it('records each call with its outcome', async () => {
      const { toolkit, handler } = setup();
      handler({ name: 'get_account' }).mockRejectedValueOnce(new Error('boom'));

      await call({ toolkit, name: 'get_categories', callId: 'c1' });
      await call({ toolkit, name: 'get_account', input: { accountId: ACCOUNT }, callId: 'c2' });

      expect(toolkit.toolCallRecords()).toEqual([
        expect.objectContaining({ callId: 'c1', toolName: 'get_categories', status: 'ok' }),
        expect.objectContaining({
          callId: 'c2',
          toolName: 'get_account',
          status: 'error',
          error: expect.stringContaining('boom'),
        }),
      ]);
    });

    it('refuses the 61st tool call with a tool error and a notice, and runs no handler for it', async () => {
      const { toolkit, handler, events } = setup();

      for (let index = 0; index < CHAT_MAX_TOOL_CALLS; index++) {
        expect((await call({ toolkit, name: 'get_categories' })).isError).toBe(false);
      }
      const refused = await call({ toolkit, name: 'get_categories' });
      await call({ toolkit, name: 'get_categories' });

      expect(refused.isError).toBe(true);
      expect(refused.text).toContain(String(CHAT_MAX_TOOL_CALLS));
      expect(handler({ name: 'get_categories' })).toHaveBeenCalledTimes(CHAT_MAX_TOOL_CALLS);
      expect(noticesIn({ events })).toEqual([
        expect.objectContaining({
          key: expect.stringMatching(/^chat\.notices\./),
          params: { limit: CHAT_MAX_TOOL_CALLS },
        }),
      ]);
    });

    it('refuses the 11th third-party read', async () => {
      const { toolkit, handler, events } = setup();

      for (let index = 0; index < CHAT_MAX_THIRD_PARTY_READS; index++) {
        expect((await call({ toolkit, name: 'search_coingecko_coins', input: { query: 'btc' } })).isError).toBe(false);
      }
      const refused = await call({ toolkit, name: 'search_coingecko_coins', input: { query: 'btc' } });
      const otherRead = await call({ toolkit, name: 'get_categories' });

      expect(refused.isError).toBe(true);
      expect(refused.text).toContain(String(CHAT_MAX_THIRD_PARTY_READS));
      expect(otherRead.isError).toBe(false);
      expect(handler({ name: 'search_coingecko_coins' })).toHaveBeenCalledTimes(CHAT_MAX_THIRD_PARTY_READS);
      expect(noticesIn({ events })).toHaveLength(1);
    });
  });

  describe('writes', () => {
    it('stores a proposal without calling the handler, strips _chat and answers with the ref', async () => {
      const { toolkit, handler, events } = setup();

      const result = await call({
        toolkit,
        name: 'create_tag',
        input: tagInput({ _chat: { uncertain: [{ field: 'color', reason: 'guessedFromHistory' }] } }),
      });

      expect(handler({ name: 'create_tag' })).not.toHaveBeenCalled();
      expect(createSpy()).toHaveBeenCalledTimes(1);
      const values = createSpy().mock.calls[0]![0] as any;
      expect(values).toMatchObject({
        userId: CHAT_TEST_USER_ID,
        threadId: CHAT_TEST_THREAD_ID,
        messageId: CHAT_TEST_MESSAGE_ID,
        toolName: 'create_tag',
        proposedArgs: tagInput(),
        args: tagInput(),
        cardKind: 'create',
        entity: 'tag',
        danger: 'none',
        confirmation: 'none',
        status: 'pending',
        dependsOn: [],
        uncertainFields: [{ field: 'color', reason: 'guessedFromHistory' }],
      });
      expect(values.args).not.toHaveProperty('_chat');
      expect(values.proposedArgs).not.toHaveProperty('_chat');
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text)).toEqual({
        proposalId: values.id,
        ref: `$proposal:${values.id}`,
        status: 'proposed',
      });
      expect(new Date(values.expiresAt).getTime()).toBeGreaterThan(Date.now() + CHAT_PROPOSAL_LIFETIME_MS - 60_000);

      expect(events).toContainEqual({
        type: 'part.started',
        part: { type: 'proposal', id: expect.any(String), proposalId: values.id },
      });
      expect(cardsIn({ events })).toEqual([
        expect.objectContaining({ id: values.id, status: 'pending', toolName: 'create_tag', revision: 1 }),
      ]);
    });

    it('builds the card from the policy, the arguments and the schema', async () => {
      const { toolkit, events } = setup();

      await call({
        toolkit,
        name: 'create_transaction',
        input: transaction({
          _chat: { uncertain: [{ field: 'categoryId', reason: 'ambiguousMatch', alternatives: [P1] }] },
          categoryId: P1,
        }),
      });

      const card = cardsIn({ events })[0]!;
      expect(card).toMatchObject({
        kind: 'create',
        entity: 'transaction',
        danger: 'none',
        confirmation: { mode: 'none' },
        title: { key: 'chat.cards.title.create', params: { entity: 'transaction' } },
        dependsOn: [],
        warnings: [],
        sources: [],
        canApply: { ok: true },
        editedByUser: false,
      });
      expect(
        Math.abs(new Date(card.expiresAt).getTime() - new Date(card.createdAt).getTime() - CHAT_PROPOSAL_LIFETIME_MS),
      ).toBeLessThan(5_000);

      const field = ({ path }: { path: string }) => card.fields.find((candidate) => candidate.path === path)!;
      expect(field({ path: 'accountId' })).toMatchObject({
        labelKey: 'chat.fields.accountId',
        value: ACCOUNT,
        display: { kind: 'entity' },
        editable: { type: 'entity', entity: 'account' },
      });
      expect(field({ path: 'transactionType' }).editable).toMatchObject({
        type: 'enum',
        options: expect.arrayContaining(['income', 'expense']),
      });
      expect(field({ path: 'categoryId' }).uncertain).toEqual({ reason: 'ambiguousMatch', alternatives: [P1] });
      expect(field({ path: 'amount' })).toMatchObject({ display: { kind: 'money' }, editable: { type: 'money' } });
      expect(field({ path: 'note' })).toBeUndefined();
    });

    it('marks a plain card safe for approve-all, and a card with an uncertain field not', async () => {
      const { toolkit, events } = setup();

      await call({ toolkit, name: 'create_tag', input: tagInput() });
      await call({
        toolkit,
        name: 'create_tag',
        input: tagInput({ name: 'Tea', _chat: { uncertain: [{ field: 'color', reason: 'other' }] } }),
      });

      const [plain, unsure] = cardsIn({ events });
      expect(isSafeForApproveAll({ card: plain!, cards: [plain!, unsure!] })).toBe(true);
      expect(isSafeForApproveAll({ card: unsure!, cards: [plain!, unsure!] })).toBe(false);
      expect(plain!.safe).toBe(true);
      expect(unsure!.safe).toBe(false);
    });

    it('records the earlier reads, the attachments and the page context as the sources of a card', async () => {
      const { toolkit, events } = setup({
        runOverrides: {
          attachments: [{ id: ATTACHMENT, fileName: 'statement.csv' }],
          pageContext: { route: 'accounts', entity: { kind: 'account', id: ACCOUNT } },
        },
      });

      await call({ toolkit, name: 'get_categories', callId: 'call-1' });
      await call({ toolkit, name: 'get_account', input: { accountId: ACCOUNT }, callId: 'call-2' });
      await call({ toolkit, name: 'create_tag', input: tagInput() });

      expect(cardsIn({ events })[0]!.sources).toEqual([
        { type: 'toolCall', callId: 'call-1', toolName: 'get_categories', args: {} },
        { type: 'toolCall', callId: 'call-2', toolName: 'get_account', args: { accountId: ACCOUNT } },
        { type: 'attachment', attachmentId: ATTACHMENT, fileName: 'statement.csv' },
        { type: 'pageContext', context: { route: 'accounts', entity: { kind: 'account', id: ACCOUNT } } },
      ]);
    });

    it('narrows the sources to _chat.sourceCallIds', async () => {
      const { toolkit, events } = setup();

      await call({ toolkit, name: 'get_categories', callId: 'call-1' });
      await call({ toolkit, name: 'get_accounts', callId: 'call-2' });
      await call({ toolkit, name: 'create_tag', input: tagInput({ _chat: { sourceCallIds: ['call-2'] } }) });

      expect(cardsIn({ events })[0]!.sources).toEqual([
        expect.objectContaining({ type: 'toolCall', callId: 'call-2', toolName: 'get_accounts' }),
      ]);
    });

    it('refuses a bad enum as a tool error and creates no card', async () => {
      const { toolkit } = setup();

      const result = await call({
        toolkit,
        name: 'create_transaction',
        input: transaction({ transactionType: 'sideways' }),
      });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/transactionType/);
      expect(createSpy()).not.toHaveBeenCalled();
    });

    it('refuses a create_transaction with an original amount but no original currency', async () => {
      const { toolkit } = setup();

      const result = await call({ toolkit, name: 'create_transaction', input: transaction({ originalAmount: 10 }) });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/originalCurrencyCode/i);
      expect(createSpy()).not.toHaveBeenCalled();
    });

    it('refuses a bulk delete with empty filters through execute, with no card', async () => {
      const { toolkit, handler } = setup();

      const result = await call({ toolkit, name: 'bulk_delete_transactions', input: { filters: {} } });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/narrowing filter/i);
      expect(createSpy()).not.toHaveBeenCalled();
      expect(handler({ name: 'bulk_delete_transactions' })).not.toHaveBeenCalled();
    });

    it('never reaches the handler of any write tool, whether its arguments are valid, empty or hostile', async () => {
      const { toolkit, catalog } = setup();
      const writeNames = toolkit.tools.filter((tool) => tool.kind === 'write').map((tool) => tool.name);
      expect(writeNames.length).toBeGreaterThan(100);

      for (const name of writeNames) {
        for (const input of [
          {},
          { id: ACCOUNT, confirm: true, _chat: { approved: true } },
          { filters: {}, force: true },
        ]) {
          await call({ toolkit, name, input });
        }
      }

      const reached = catalog
        .filter((entry) => writeNames.includes(entry.name))
        .filter((entry) => jest.mocked(entry.invoke).mock.calls.length > 0)
        .map((entry) => entry.name);
      expect(reached).toEqual([]);
    });

    it('refuses an uncertainty reason outside the enum', async () => {
      const { toolkit } = setup();

      const result = await call({
        toolkit,
        name: 'create_tag',
        input: tagInput({ _chat: { uncertain: [{ field: 'color', reason: 'hunch' }] } }),
      });

      expect(result.isError).toBe(true);
      expect(createSpy()).not.toHaveBeenCalled();
    });

    it('finds refs at any depth, records the dependencies and keeps the refs in the stored arguments', async () => {
      const { toolkit, events } = setup();
      findAllSpy().mockResolvedValue([
        parentRow({ id: P1, toolName: 'create_category' }),
        parentRow({ id: P2, toolName: 'create_tag' }),
      ] as never);

      const result = await call({
        toolkit,
        name: 'create_transaction',
        input: transaction({ categoryId: ref({ id: P1 }), tagIds: [ref({ id: P2 })] }),
      });

      expect(result.isError).toBe(false);
      const values = createSpy().mock.calls[0]![0] as any;
      expect(values.dependsOn).toEqual([P1, P2]);
      expect(values.args).toEqual(transaction({ categoryId: ref({ id: P1 }), tagIds: [ref({ id: P2 })] }));
      expect((findAllSpy().mock.calls[0]![0] as any).where).toMatchObject({
        userId: CHAT_TEST_USER_ID,
        threadId: CHAT_TEST_THREAD_ID,
      });
      expect(cardsIn({ events })[0]!.dependsOn).toEqual([
        {
          id: P1,
          title: { key: 'chat.cards.title.create', params: { entity: 'category' } },
          status: 'pending',
          revision: 1,
        },
        {
          id: P2,
          title: { key: 'chat.cards.title.create', params: { entity: 'tag' } },
          status: 'pending',
          revision: 1,
        },
      ]);
    });

    it('refuses a ref to an unknown or foreign proposal', async () => {
      const { toolkit } = setup();
      findAllSpy().mockResolvedValue([]);

      const result = await call({
        toolkit,
        name: 'create_transaction',
        input: transaction({ categoryId: ref({ id: P1 }) }),
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain(P1);
      expect(createSpy()).not.toHaveBeenCalled();
    });

    it('refuses a ref to a proposal that is no longer pending', async () => {
      const { toolkit } = setup();
      findAllSpy().mockResolvedValue([parentRow({ id: P1, status: 'rejected' })] as never);

      const result = await call({
        toolkit,
        name: 'create_transaction',
        input: transaction({ categoryId: ref({ id: P1 }) }),
      });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/rejected/);
      expect(createSpy()).not.toHaveBeenCalled();
    });

    it('refuses a standalone tool that refers to a proposal, and a ref to a standalone proposal', async () => {
      const { toolkit } = setup();
      findAllSpy().mockResolvedValue([parentRow({ id: P1 })] as never);

      const child = await call({ toolkit, name: 'delete_import_batch', input: { batchId: ref({ id: P1 }) } });

      expect(child.isError).toBe(true);
      expect(child.text).toMatch(/on its own/);

      findAllSpy().mockResolvedValue([parentRow({ id: P1, toolName: 'delete_import_batch' })] as never);
      const parent = await call({
        toolkit,
        name: 'create_transaction',
        input: transaction({ categoryId: ref({ id: P1 }) }),
      });

      expect(parent.isError).toBe(true);
      expect(parent.text).toMatch(/on its own/);
      expect(createSpy()).not.toHaveBeenCalled();
    });

    it('makes an egress tool an amber card with the host, a confirmation and never safe', async () => {
      const { toolkit, events } = setup();

      const result = await call({
        toolkit,
        name: 'set_currency_rate_source',
        input: {
          code: 'XYZ',
          rateSource: 'http',
          config: { urlTemplate: 'https://attacker.example/?d={date}', jsonPath: 'data.price' },
        },
      });

      expect(result.isError).toBe(false);
      expect(cardsIn({ events })[0]).toMatchObject({
        egress: { url: 'https://attacker.example/?d={date}', host: 'attacker.example' },
        confirmation: { mode: 'confirm' },
        warnings: [{ key: 'chat.warnings.egress', params: { host: 'attacker.example' } }],
        safe: false,
      });
    });

    it('marks the card named by _chat.replaces as superseded and links the new one to it', async () => {
      const { toolkit, events } = setup();
      const old = {
        ...parentRow({ id: OLD, toolName: 'create_tag' }),
        update: jest.fn(async function (this: any, values: Record<string, unknown>) {
          Object.assign(this, values);
          return this;
        }),
      };
      jest.mocked(ChatProposals.findOne).mockResolvedValue(old as never);

      const result = await call({ toolkit, name: 'create_tag', input: tagInput({ _chat: { replaces: OLD } }) });

      expect(result.isError).toBe(false);
      expect((jest.mocked(ChatProposals.findOne).mock.calls[0]![0] as any).where).toMatchObject({
        id: OLD,
        userId: CHAT_TEST_USER_ID,
        threadId: CHAT_TEST_THREAD_ID,
        status: 'pending',
      });
      expect(old.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'superseded' }));
      expect((createSpy().mock.calls[0]![0] as any).supersedesId).toBe(OLD);
      expect(cardsIn({ events }).map((card) => [card.id, card.status])).toEqual([
        [expect.any(String), 'pending'],
        [OLD, 'superseded'],
      ]);
    });

    it('refuses _chat.replaces when that card is not a pending card of the thread', async () => {
      const { toolkit } = setup();

      const result = await call({ toolkit, name: 'create_tag', input: tagInput({ _chat: { replaces: OLD } }) });

      expect(result.isError).toBe(true);
      expect(createSpy()).not.toHaveBeenCalled();
    });

    it('refuses the 101st proposal with a tool error and a notice', async () => {
      const { toolkit, events } = setup();

      for (let index = 0; index < CHAT_MAX_PROPOSALS; index++) {
        expect((await call({ toolkit, name: 'create_tag', input: tagInput({ name: `Tag ${index}` }) })).isError).toBe(
          false,
        );
      }
      const refused = await call({ toolkit, name: 'create_tag', input: tagInput({ name: 'One too many' }) });

      expect(refused.isError).toBe(true);
      expect(refused.text).toContain(String(CHAT_MAX_PROPOSALS));
      expect(createSpy()).toHaveBeenCalledTimes(CHAT_MAX_PROPOSALS);
      expect(noticesIn({ events })).toHaveLength(1);
    });

    it('does not count proposals against the tool-call cap', async () => {
      const { toolkit } = setup();

      for (let index = 0; index < CHAT_MAX_TOOL_CALLS + 5; index++) {
        await call({ toolkit, name: 'create_tag', input: tagInput({ name: `Tag ${index}` }) });
      }

      expect((await call({ toolkit, name: 'get_categories' })).isError).toBe(false);
    });

    it('keeps a red card unapplicable while its preview resolver is not registered', async () => {
      const { toolkit, events } = setup();

      await call({ toolkit, name: 'bulk_delete_transactions', input: { transactionIds: [ACCOUNT] } });

      expect(cardsIn({ events })[0]).toMatchObject({
        kind: 'bulk',
        danger: 'destructive',
        confirmation: { mode: 'confirm' },
        canApply: { ok: false, reasonKey: 'chat.cards.previewPending' },
        safe: false,
      });
    });

    it('stores the preview, the snapshot and the typed confirmation a registered resolver computes', async () => {
      const { toolkit, events } = setup();
      const resolver = jest.fn(async () => ({
        preview: { affected: { count: 3, columns: [], rows: [], truncated: false } },
        snapshot: { targetIds: ['a', 'b', 'c'], targetHash: 'hash' },
        affectedCount: 3,
        warnings: [{ key: 'chat.warnings.transferTwin', params: { count: 1 } }],
      }));
      (PREVIEW_RESOLVERS as Record<string, unknown>).bulkDeleteTransactions = resolver;

      await call({ toolkit, name: 'bulk_delete_transactions', input: { transactionIds: [ACCOUNT] } });

      expect(resolver).toHaveBeenCalledWith(
        expect.objectContaining({ userId: CHAT_TEST_USER_ID, args: { transactionIds: [ACCOUNT] } }),
      );
      const values = createSpy().mock.calls[0]![0] as any;
      expect(values).toMatchObject({
        confirmation: 'typed',
        confirmationPhrase: '3',
        preview: expect.objectContaining({ affected: expect.objectContaining({ count: 3 }) }),
        snapshot: { baseCurrencyCode: 'USD', targetIds: ['a', 'b', 'c'], targetHash: 'hash', parentStatuses: {} },
      });
      expect(cardsIn({ events })[0]).toMatchObject({
        canApply: { ok: true },
        confirmation: { mode: 'typed', phrase: '3' },
        affected: { count: 3 },
        warnings: [{ key: 'chat.warnings.transferTwin', params: { count: 1 } }],
        safe: false,
      });
    });

    it('records the parents statuses in the snapshot', async () => {
      const { toolkit } = setup();
      findAllSpy().mockResolvedValue([parentRow({ id: P1 })] as never);

      await call({ toolkit, name: 'create_transaction', input: transaction({ categoryId: ref({ id: P1 }) }) });

      expect((createSpy().mock.calls[0]![0] as any).snapshot).toEqual({
        baseCurrencyCode: 'USD',
        parentStatuses: { [P1]: 'pending' },
      });
    });

    it('turns a resolver error into a card that cannot be applied, never an args-only fallback', async () => {
      const { toolkit, events } = setup();
      (PREVIEW_RESOLVERS as Record<string, unknown>).bulkDeleteTransactions = jest.fn(async () => {
        throw new Error('Preview exploded');
      });

      const result = await call({ toolkit, name: 'bulk_delete_transactions', input: { transactionIds: [ACCOUNT] } });

      expect(result.isError).toBe(false);
      expect(cardsIn({ events })[0]).toMatchObject({
        canApply: { ok: false, reasonKey: 'chat.cards.previewFailed' },
        error: { message: 'Preview exploded' },
      });
      expect((createSpy().mock.calls[0]![0] as any).error).toEqual({ message: 'Preview exploded' });
    });

    it('retracts the text of the run on its first card', async () => {
      const { toolkit, events, run } = setup();
      await run.textPolicy.delta({ partId: 't1', delta: 'Let me check' });

      await call({ toolkit, name: 'create_tag', input: tagInput() });

      expect(events).toContainEqual({ type: 'text.retracted', partIds: ['t1'] });
      expect(run.textPolicy.hasCard()).toBe(true);
    });

    it('does not count a refused proposal as a card', async () => {
      const { toolkit, run } = setup();

      await call({ toolkit, name: 'create_transaction', input: transaction({ transactionType: 'sideways' }) });

      expect(run.textPolicy.hasCard()).toBe(false);
    });
  });

  describe('find_capabilities', () => {
    it('ranks by words of the name and the description and returns the model schemas', async () => {
      const { toolkit, catalog } = setup();

      const result = await call({ toolkit, name: 'find_capabilities', input: { query: 'delete account' } });

      expect(result.isError).toBe(false);
      const { matches } = JSON.parse(result.text) as { matches: Array<Record<string, any>> };
      expect(matches[0]).toMatchObject({ name: 'delete_account', kind: 'write' });
      expect(matches[0]!.description).toEqual(expect.any(String));
      expect(matches[0]!.inputSchema).toEqual(
        JSON.parse(
          JSON.stringify(getModelSchema({ entry: catalog.find((entry) => entry.name === 'delete_account')! })),
        ),
      );
      expect(matches.length).toBeLessThanOrEqual(8);
    });

    it('adds every returned tool to the active set', async () => {
      const { toolkit } = setup();
      expect(toolkit.activeToolNames()).not.toContain('delete_account');

      const result = await call({ toolkit, name: 'find_capabilities', input: { query: 'delete account' } });

      const names = (JSON.parse(result.text) as { matches: Array<{ name: string }> }).matches.map(
        (match) => match.name,
      );
      for (const name of names) expect(toolkit.activeToolNames()).toContain(name);
    });

    it('never offers an excluded tool, and answers an empty list when nothing matches', async () => {
      const { toolkit } = setup();

      const excluded = await call({
        toolkit,
        name: 'find_capabilities',
        input: { query: 'create attachment upload url' },
      });
      const nothing = await call({ toolkit, name: 'find_capabilities', input: { query: 'zzzzqqqq' } });

      expect(
        (JSON.parse(excluded.text) as { matches: Array<{ name: string }> }).matches.map((match) => match.name),
      ).not.toContain('create_attachment_upload_url');
      expect(JSON.parse(nothing.text)).toEqual({ matches: [] });
    });

    it('refuses an empty query', async () => {
      const { toolkit } = setup();

      expect((await call({ toolkit, name: 'find_capabilities', input: { query: '  ' } })).isError).toBe(true);
    });
  });

  describe('ask_clarification', () => {
    const question = {
      question: 'Which account?',
      options: [{ label: 'Cash' }, { label: 'Card' }],
    };

    it('shows the question and marks the run as waiting', async () => {
      const { toolkit, events, run } = setup();

      const result = await call({ toolkit, name: 'ask_clarification', input: question });

      expect(result.isError).toBe(false);
      expect(events).toContainEqual({
        type: 'part.started',
        part: {
          type: 'clarification',
          id: expect.any(String),
          question: 'Which account?',
          options: [
            { id: 'o1', label: 'Cash' },
            { id: 'o2', label: 'Card' },
          ],
          allowFreeText: false,
          multiSelect: false,
        },
      });
      expect(toolkit.isAwaitingClarification()).toBe(true);
      expect(run.textPolicy.hasCard()).toBe(true);
    });

    it('answers every later tool call of the run with the waiting error and creates nothing', async () => {
      const { toolkit, handler } = setup();
      await call({ toolkit, name: 'ask_clarification', input: question });

      const read = await call({ toolkit, name: 'get_categories' });
      const write = await call({ toolkit, name: 'create_transaction', input: transaction() });
      const second = await call({ toolkit, name: 'ask_clarification', input: question });

      for (const result of [read, write, second]) {
        expect(result.isError).toBe(true);
        expect(result.text).toMatch(/waiting/i);
      }
      expect(handler({ name: 'get_categories' })).not.toHaveBeenCalled();
      expect(createSpy()).not.toHaveBeenCalled();
    });

    it.each([
      ['a question over 300 characters', { ...question, question: 'q'.repeat(301) }],
      [
        'more than 8 options',
        { question: 'Which?', options: Array.from({ length: 9 }, (_, i) => ({ label: `O${i}` })) },
      ],
      [
        'an option label over 80 characters',
        { question: 'Which?', options: [{ label: 'a'.repeat(81) }, { label: 'b' }] },
      ],
      ['a single option without free text', { question: 'Which?', options: [{ label: 'Only' }] }],
      [
        'duplicate option ids',
        {
          question: 'Which?',
          options: [
            { id: 'x', label: 'A' },
            { id: 'x', label: 'B' },
          ],
        },
      ],
    ])('refuses %s', async (_label, input) => {
      const { toolkit } = setup();

      const result = await call({ toolkit, name: 'ask_clarification', input });

      expect(result.isError).toBe(true);
      expect(toolkit.isAwaitingClarification()).toBe(false);
    });

    it('takes free text without options and keeps given option ids', async () => {
      const { toolkit, events } = setup();

      const result = await call({
        toolkit,
        name: 'ask_clarification',
        input: { question: 'What is the merchant?', options: [], allowFreeText: true, multiSelect: false },
      });

      expect(result.isError).toBe(false);
      expect(events).toContainEqual({
        type: 'part.started',
        part: expect.objectContaining({ type: 'clarification', options: [], allowFreeText: true }),
      });
    });
  });

  describe('render tools', () => {
    const chart = {
      type: 'chart',
      kind: 'bar',
      title: 'Spend',
      unit: { kind: 'money', currencyCode: 'USD' },
      xAxis: { type: 'category', values: ['Food', 'Rent'] },
      series: [{ name: 'September', values: [120, 900] }],
    };
    const table = {
      type: 'table',
      title: 'Accounts',
      columns: [
        { key: 'account', label: 'Account', kind: 'entity' },
        { key: 'balance', label: 'Balance', kind: 'money', currencyCode: 'USD' },
      ],
      rows: [{ account: { kind: 'account', id: ACCOUNT }, balance: 10 }],
    };
    const kpis = { type: 'kpis', items: [{ label: 'Total', value: 10, kind: 'number' }] };

    it.each([
      ['render_chart', chart],
      ['render_table', table],
      ['render_kpis', kpis],
    ])('%s emits a visual part for a valid spec', async (name, spec) => {
      const { toolkit, events } = setup();

      const result = await call({ toolkit, name, input: { spec } });

      expect(result.isError).toBe(false);
      expect(events).toContainEqual({ type: 'part.started', part: { type: 'visual', id: expect.any(String), spec } });
    });

    it('refuses an invalid spec and a spec of the wrong type', async () => {
      const { toolkit, events } = setup();

      const mismatched = await call({
        toolkit,
        name: 'render_chart',
        input: { spec: { ...chart, series: [{ name: 'September', values: [1] }] } },
      });
      const wrongType = await call({ toolkit, name: 'render_chart', input: { spec: kpis } });

      expect(mismatched.isError).toBe(true);
      expect(mismatched.text).toMatch(/series/);
      expect(wrongType.isError).toBe(true);
      expect(events.filter((event) => event.type === 'part.started')).toEqual([]);
    });

    it('refuses a table whose entity cell names an id the user does not own', async () => {
      const { toolkit, events } = setup();
      jest.mocked(resolveEntityLabels).mockResolvedValue({
        spec: table as never,
        foreign: [{ kind: 'account', id: ACCOUNT }],
      });

      const result = await call({ toolkit, name: 'render_table', input: { spec: table } });

      expect(resolveEntityLabels).toHaveBeenCalledWith({ userId: CHAT_TEST_USER_ID, spec: table });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(ACCOUNT);
      expect(events).toEqual([]);
    });

    it('emits the table with the labels the server resolved, and drops a label the model sent', async () => {
      const { toolkit, events } = setup();
      const resolved = {
        ...table,
        rows: [{ account: { kind: 'account', id: ACCOUNT, label: 'Monobank' }, balance: 10 }],
      };
      jest.mocked(resolveEntityLabels).mockResolvedValue({ spec: resolved as never, foreign: [] });

      const result = await call({
        toolkit,
        name: 'render_table',
        input: {
          spec: { ...table, rows: [{ account: { kind: 'account', id: ACCOUNT, label: 'Injected' }, balance: 10 }] },
        },
      });

      expect(result.isError).toBe(false);
      // The resolver is handed the validated spec, in which the model's label is already gone.
      expect(resolveEntityLabels).toHaveBeenCalledWith({ userId: CHAT_TEST_USER_ID, spec: table });
      expect(events).toContainEqual({
        type: 'part.started',
        part: { type: 'visual', id: expect.any(String), spec: resolved },
      });
    });

    it('allows at most 8 visuals per message', async () => {
      const { toolkit } = setup();

      for (let index = 0; index < 8; index++) {
        expect((await call({ toolkit, name: 'render_kpis', input: { spec: kpis } })).isError).toBe(false);
      }

      expect((await call({ toolkit, name: 'render_kpis', input: { spec: kpis } })).isError).toBe(true);
    });
  });

  describe('read_attachment', () => {
    const attachment = (overrides: Record<string, unknown> = {}) => ({
      id: ATTACHMENT,
      fileName: 'statement.csv',
      kind: 'csv',
      pageCount: null,
      extractedText: 'abcdefghij',
      ...overrides,
    });

    it('reads only an attachment of the same thread and user', async () => {
      const { toolkit } = setup();
      jest.mocked(ChatAttachments.findOne).mockResolvedValue(attachment() as never);

      const result = await call({ toolkit, name: 'read_attachment', input: { attachmentId: ATTACHMENT } });

      expect((jest.mocked(ChatAttachments.findOne).mock.calls[0]![0] as any).where).toMatchObject({
        id: ATTACHMENT,
        threadId: CHAT_TEST_THREAD_ID,
        userId: CHAT_TEST_USER_ID,
      });
      expect(JSON.parse(result.text)).toMatchObject({ fileName: 'statement.csv', text: 'abcdefghij', hasMore: false });
    });

    it('refuses an attachment outside the thread', async () => {
      const { toolkit } = setup();

      const result = await call({ toolkit, name: 'read_attachment', input: { attachmentId: ATTACHMENT } });

      expect(result.isError).toBe(true);
    });

    it('reads a window of the text', async () => {
      const { toolkit } = setup();
      jest.mocked(ChatAttachments.findOne).mockResolvedValue(attachment() as never);

      const result = await call({
        toolkit,
        name: 'read_attachment',
        input: { attachmentId: ATTACHMENT, offset: 2, length: 3 },
      });

      expect(JSON.parse(result.text)).toMatchObject({ text: 'cde', offset: 2, totalChars: 10, hasMore: true });
    });

    it('explains that an image reaches the model as an image, not as text', async () => {
      const { toolkit } = setup();
      jest
        .mocked(ChatAttachments.findOne)
        .mockResolvedValue(attachment({ kind: 'image', extractedText: null }) as never);

      const result = await call({ toolkit, name: 'read_attachment', input: { attachmentId: ATTACHMENT } });

      expect(result.isError).toBe(false);
      expect(result.text).toMatch(/image/i);
    });

    it('wraps the text of the attachment when the run asks for it', async () => {
      const wrapUntrusted = jest.fn(({ kind, text }: { kind: string; text: string }) => `<${kind}>${text}`);
      const { toolkit } = setup({ runOverrides: { wrapUntrusted } });
      jest.mocked(ChatAttachments.findOne).mockResolvedValue(attachment() as never);

      const result = await call({ toolkit, name: 'read_attachment', input: { attachmentId: ATTACHMENT } });

      expect(wrapUntrusted).toHaveBeenCalledWith({ kind: 'attachment', text: 'abcdefghij' });
      expect(JSON.parse(result.text).text).toBe('<attachment>abcdefghij');
    });
  });
});
