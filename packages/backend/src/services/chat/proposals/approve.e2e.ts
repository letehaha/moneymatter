import {
  API_ERROR_CODES,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type ChatProposalCard,
} from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as posthog from '@js/utils/posthog';
import ChatProposals from '@models/chat-proposals.model';
import { redisClient } from '@root/redis-client';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { cardFor, proposalRefsIn, proposeCards, provisionDemoUser } from '@tests/helpers/chat-cards';
import { failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';
import { http, HttpResponse } from 'msw';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

const OTHER_ID = '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a';

const transactionArgs = ({ accountId, ...rest }: { accountId: string } & Record<string, unknown>) => ({
  accountId,
  amount: 4.5,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: PAYMENT_TYPES.creditCard,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  ...rest,
});

/** A category and a tag, then a transaction that uses both through `$proposal:` refs. */
const chainTurns = ({ accountId }: { accountId: string }) => [
  {
    toolCalls: [
      { id: 'call_category', name: 'create_category', arguments: { name: 'Chat Groceries', color: '#4CAF50' } },
      { id: 'call_tag', name: 'create_tag', arguments: { name: 'Chat Weekly', color: '#2d7d46' } },
    ],
  },
  (body: Parameters<typeof proposalRefsIn>[0]['body']) => {
    const [categoryRef, tagRef] = proposalRefsIn({ body });
    return {
      toolCalls: [
        {
          id: 'call_tx',
          name: 'create_transaction',
          arguments: transactionArgs({ accountId, categoryId: categoryRef, tagIds: [tagRef] }),
        },
      ],
    };
  },
  { text: 'Done.' },
];

/** A transfer between two accounts of the user: its two legs, base leg first. */
const createTransfer = async () => {
  const from = await helpers.createAccount({ raw: true });
  const to = await helpers.createAccount({ raw: true });
  const [base, opposite] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId: from.id, amount: 500 }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: 500,
      destinationAccountId: to.id,
    },
    raw: true,
  });
  return { base, opposite: opposite! };
};

const proposeDelete = ({ id }: { id: string }) =>
  proposeCards({ turns: [{ toolCalls: [{ name: 'delete_transaction', arguments: { id } }] }, { text: 'Done.' }] });

const errorOf = ({ response }: { response: { body: { response: unknown } } }) =>
  response.body.response as { message: string; code: string; details?: Record<string, any> };

const importBatch = async () => {
  const account = await helpers.createAccount({ raw: true });
  return helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });
};

const proposeDeleteBatch = (batchId: string) =>
  proposeCards({
    turns: [
      { toolCalls: [{ id: 'call_find', name: 'find_capabilities', arguments: { query: 'delete import batch' } }] },
      { toolCalls: [{ id: 'call_batch', name: 'delete_import_batch', arguments: { batchId } }] },
      { text: 'Done.' },
    ],
  });

describe('POST /chat/proposals/:id/approve', () => {
  describe('chains', () => {
    it('applies a transaction with the category and tag cards it depends on, in order, with their real ids', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards } = await proposeCards({ turns: chainTurns({ accountId: account.id }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const tag = cardFor({ cards, toolName: 'create_tag' });
      const tx = cardFor({ cards, toolName: 'create_transaction' });
      expect(tx.dependsOn.map((dependency) => dependency.id).toSorted()).toEqual([category.id, tag.id].toSorted());

      const approved = await helpers.approveChatProposal({
        proposalId: tx.id,
        payload: { revision: tx.revision, parentRevisions: { [category.id]: 1, [tag.id]: 1 } },
      });

      expect(approved.statusCode).toBe(200);
      const { card, cards: after } = approved.body.response;
      expect(card).toMatchObject({ id: tx.id, status: 'applied' });
      expect(after.map((item) => [item.id, item.status]).toSorted()).toEqual(
        [category.id, tag.id, tx.id].map((id) => [id, 'applied']).toSorted(),
      );
      expect(card.result!.alsoApplied!.toSorted()).toEqual([category.id, tag.id].toSorted());

      const realCategory = (await helpers.getCategoriesList()).find((item) => item.name === 'Chat Groceries')!;
      const realTag = (await helpers.getTags({ raw: true })).find((item) => item.name === 'Chat Weekly')!;
      const [transaction] = await helpers.getTransactions({ includeTags: true, raw: true });
      expect(transaction).toMatchObject({ categoryId: realCategory.id });
      expect(transaction!.tags!.map((item) => item.id)).toEqual([realTag.id]);

      const appliedCategory = after.find((item) => item.id === category.id)!;
      expect(appliedCategory.result!.refs).toEqual([{ kind: 'category', id: realCategory.id }]);
      expect(card.result!.refs).toEqual([{ kind: 'transaction', id: transaction!.id }]);
      expect(new Date(appliedCategory.result!.appliedAt).getTime()).toBeLessThanOrEqual(
        new Date(card.result!.appliedAt).getTime(),
      );
    });

    it('nests a new account group under another new one when the child validator parses the ref', async () => {
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ id: 'call_find', name: 'find_capabilities', arguments: { query: 'create account group' } }] },
          { toolCalls: [{ id: 'call_parent', name: 'create_account_group', arguments: { name: 'Savings' } }] },
          (body) => ({
            toolCalls: [
              {
                id: 'call_child',
                name: 'create_account_group',
                arguments: { name: 'Deposits', parentGroupId: proposalRefsIn({ body })[0] },
              },
            ],
          }),
          { text: 'Done.' },
        ],
      });
      const parent = cardFor({ cards, toolName: 'create_account_group', index: 0 });
      const child = cardFor({ cards, toolName: 'create_account_group', index: 1 });
      expect(child.dependsOn.map((dependency) => dependency.id)).toEqual([parent.id]);

      const approved = await helpers.approveChatProposal({
        proposalId: child.id,
        payload: { revision: child.revision, parentRevisions: { [parent.id]: parent.revision } },
      });

      expect(approved.statusCode).toBe(200);
      const groups = await helpers.getAccountGroups({ raw: true });
      const savings = groups.find((group) => group.name === 'Savings')!;
      expect(savings.childGroups.map((group) => group.name)).toEqual(['Deposits']);
    });

    it('rolls the parents back when the child fails, and marks every card of the chain failed with the error', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards } = await proposeCards({ turns: chainTurns({ accountId: account.id }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const tag = cardFor({ cards, toolName: 'create_tag' });
      const tx = cardFor({ cards, toolName: 'create_transaction' });
      // The account goes after the proposal, so the transaction handler throws.
      expect((await helpers.deleteAccount({ id: account.id, raw: false })).statusCode).toBe(200);

      const approved = await helpers.approveChatProposal({
        proposalId: tx.id,
        payload: { revision: 1, parentRevisions: { [category.id]: 1, [tag.id]: 1 } },
      });

      expect(approved.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(errorOf({ response: approved }).details!.reason).toBe('failed');
      expect((await helpers.getCategoriesList()).some((item) => item.name === 'Chat Groceries')).toBe(false);
      expect((await helpers.getTags({ raw: true })).some((item) => item.name === 'Chat Weekly')).toBe(false);
      for (const id of [category.id, tag.id, tx.id]) {
        const card = await helpers.getChatProposal({ proposalId: id, raw: true });
        expect(card.status).toBe('failed');
        expect(card.error?.message).toEqual(expect.any(String));
      }
    });

    it('answers 409 with the current cards when a parent was edited from another tab', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards } = await proposeCards({ turns: chainTurns({ accountId: account.id }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const tag = cardFor({ cards, toolName: 'create_tag' });
      const tx = cardFor({ cards, toolName: 'create_transaction' });
      const edited = await helpers.editChatProposal({
        proposalId: category.id,
        payload: { revision: 1, args: { name: 'Chat Supermarket' } },
      });
      expect(edited.statusCode).toBe(200);

      const approved = await helpers.approveChatProposal({
        proposalId: tx.id,
        payload: { revision: 1, parentRevisions: { [category.id]: 1, [tag.id]: 1 } },
      });

      expect(approved.statusCode).toBe(ERROR_CODES.ConflictError);
      const { details } = errorOf({ response: approved });
      expect(details).toMatchObject({ reason: 'revision', card: { id: tx.id, status: 'pending' } });
      expect((details!.cards as ChatProposalCard[]).find((card) => card.id === category.id)).toMatchObject({
        revision: 2,
      });
      expect(await helpers.getTransactions({ raw: true })).toEqual([]);
    });

    it('answers 409 when the card itself was edited since the approver saw it', async () => {
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'create_category', arguments: { name: 'Chat Travel', color: '#4CAF50' } }] },
          { text: 'Done.' },
        ],
      });
      const category = cardFor({ cards, toolName: 'create_category' });
      await helpers.editChatProposal({
        proposalId: category.id,
        payload: { revision: 1, args: { name: 'Chat Trips' } },
      });

      const approved = await helpers.approveChatProposal({ proposalId: category.id, payload: { revision: 1 } });

      expect(approved.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(errorOf({ response: approved }).details).toMatchObject({ reason: 'revision', card: { revision: 2 } });
      expect((await helpers.getCategoriesList()).some((item) => item.name === 'Chat Trips')).toBe(false);
    });

    it('applies once when two approvals of one card race, and answers the second with the applied card', async () => {
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'create_category', arguments: { name: 'Chat Race', color: '#4CAF50' } }] },
          { text: 'Done.' },
        ],
      });
      const category = cardFor({ cards, toolName: 'create_category' });

      const [first, second] = await Promise.all([
        helpers.approveChatProposal({ proposalId: category.id, payload: { revision: 1 } }),
        helpers.approveChatProposal({ proposalId: category.id, payload: { revision: 1 } }),
      ]);

      expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
      expect(first.body.response.card.status).toBe('applied');
      expect(second.body.response.card.status).toBe('applied');
      expect((await helpers.getCategoriesList()).filter((item) => item.name === 'Chat Race')).toHaveLength(1);
    });

    it('runs the handler as the card owner under the chat client id', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tracked = jest.spyOn(posthog, 'trackEvent');
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'create_category', arguments: { name: 'Chat Owned', color: '#4CAF50' } }] },
          { text: 'Done.' },
        ],
      });
      const category = cardFor({ cards, toolName: 'create_category' });

      await helpers.approveChatProposal({ proposalId: category.id, payload: { revision: 1 } });

      expect(tracked).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: account.userId,
          event: 'mcp_tool_used',
          properties: expect.objectContaining({ tool_name: 'create_category', client_id: 'moneymatter-chat' }),
        }),
      );
      tracked.mockRestore();
      const row = await ChatProposals.findByPk(category.id);
      expect(row).toMatchObject({ userId: account.userId, status: 'applied' });
    });

    it('keeps the executed args, result refs and applied time of an applied card, lists it, and drops it with its thread', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards, threadId } = await proposeCards({ turns: chainTurns({ accountId: account.id }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const tag = cardFor({ cards, toolName: 'create_tag' });
      const tx = cardFor({ cards, toolName: 'create_transaction' });
      await helpers.approveChatProposal({
        proposalId: tx.id,
        payload: { revision: 1, parentRevisions: { [category.id]: 1, [tag.id]: 1 } },
      });
      const realCategory = (await helpers.getCategoriesList()).find((item) => item.name === 'Chat Groceries')!;

      const stored = await helpers.getChatProposal({ proposalId: category.id, raw: true });
      expect(stored.result).toMatchObject({
        refs: [{ kind: 'category', id: realCategory.id }],
        executedArgs: expect.objectContaining({ name: 'Chat Groceries' }),
        appliedAt: expect.any(String),
      });
      const executedTx = (await helpers.getChatProposal({ proposalId: tx.id, raw: true })).result!
        .executedArgs as Record<string, unknown>;
      expect(executedTx.categoryId).toBe(realCategory.id);

      const applied = await helpers.getChatAppliedCards({ raw: true });
      expect(applied.items.map((item) => item.card.id).toSorted()).toEqual([category.id, tag.id, tx.id].toSorted());
      expect(applied.items[0]).toMatchObject({ threadId, threadTitle: expect.any(String) });
      expect(applied.nextCursor).toBeNull();

      await helpers.deleteChatThread({ threadId });
      expect((await helpers.getChatAppliedCards({ raw: true })).items).toEqual([]);
    });
  });

  describe('confirmation', () => {
    it('needs the typed count on a bulk red card and applies with it', async () => {
      const account = await helpers.createAccount({ raw: true });
      const created = await Promise.all(
        [1, 2, 3].map(() =>
          helpers.createTransaction({ payload: helpers.buildTransactionPayload({ accountId: account.id }), raw: true }),
        ),
      );
      const ids = created.map(([transaction]) => transaction.id);
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'bulk_delete_transactions', arguments: { transactionIds: ids.slice(0, 2) } }] },
          { text: 'Done.' },
        ],
      });
      const bulk = cardFor({ cards, toolName: 'bulk_delete_transactions' });
      expect(bulk.confirmation).toEqual({ mode: 'typed', phrase: '2' });

      const missing = await helpers.approveChatProposal({ proposalId: bulk.id, payload: { revision: 1 } });
      const wrong = await helpers.approveChatProposal({
        proposalId: bulk.id,
        payload: { revision: 1, confirmation: '3' },
      });
      expect(missing.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(wrong.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(3);

      const approved = await helpers.approveChatProposal({
        proposalId: bulk.id,
        payload: { revision: 1, confirmation: '2' },
      });

      expect(approved.statusCode).toBe(200);
      expect(approved.body.response.card.status).toBe('applied');
      const remaining = await helpers.getTransactions({ raw: true });
      expect(remaining.map((item) => item.id)).toEqual([ids[2]]);
    });

    it('counts both legs of a transfer on a single delete, asks for the typed count and deletes both', async () => {
      const { base, opposite } = await createTransfer();
      const { cards } = await proposeDelete({ id: base.id });
      const card = cardFor({ cards, toolName: 'delete_transaction' });

      expect(card.confirmation).toEqual({ mode: 'typed', phrase: '2' });
      expect(card.affected).toMatchObject({ count: 2 });
      expect(card.affected!.rows).toHaveLength(2);
      expect(card.warnings).toEqual([{ key: 'chat.warnings.transferTwinsOfRow', params: { count: 1 } }]);

      const wrong = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: 'confirm' },
      });
      expect(wrong.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(2);

      const approved = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: '2' },
      });

      expect(approved.statusCode).toBe(200);
      const remaining = await helpers.getTransactions({ raw: true });
      expect(remaining.map((item) => item.id)).not.toContain(base.id);
      expect(remaining.map((item) => item.id)).not.toContain(opposite.id);
    });

    it('answers 409 stale when a filter-based bulk card now matches another set, and applies the refreshed set with a new count', async () => {
      const account = await helpers.createAccount({ raw: true });
      const other = await helpers.createAccount({ raw: true });
      await Promise.all(
        [1, 2].map(() =>
          helpers.createTransaction({ payload: helpers.buildTransactionPayload({ accountId: account.id }), raw: true }),
        ),
      );
      const [elsewhere] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: other.id }),
        raw: true,
      });
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'bulk_delete_transactions', arguments: { filters: { accountIds: [account.id] } } }] },
          { text: 'Done.' },
        ],
      });
      const bulk = cardFor({ cards, toolName: 'bulk_delete_transactions' });
      expect(bulk.confirmation).toEqual({ mode: 'typed', phrase: '2' });
      // A third matching row appears after the proposal.
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const stale = await helpers.approveChatProposal({
        proposalId: bulk.id,
        payload: { revision: 1, confirmation: '2' },
      });

      expect(stale.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(errorOf({ response: stale }).details).toMatchObject({
        reason: 'stale',
        stale: { reasonKey: 'chat.stale.targets', before: 2, after: 3 },
      });
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(4);
      expect((await helpers.getChatProposal({ proposalId: bulk.id, raw: true })).status).toBe('stale');

      const refreshed = await helpers.refreshChatProposal({ proposalId: bulk.id, raw: true });
      expect(refreshed).toMatchObject({ status: 'pending', revision: 2, confirmation: { mode: 'typed', phrase: '3' } });

      const oldCount = await helpers.approveChatProposal({
        proposalId: bulk.id,
        payload: { revision: 2, confirmation: '2' },
      });
      expect(oldCount.statusCode).toBe(ERROR_CODES.ValidationError);
      const approved = await helpers.approveChatProposal({
        proposalId: bulk.id,
        payload: { revision: 2, confirmation: '3' },
      });
      expect(approved.statusCode).toBe(200);
      const remaining = await helpers.getTransactions({ raw: true });
      expect(remaining.map((item) => item.id)).toEqual([elsewhere.id]);
    });

    it('needs the word confirm on a single red card', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [transaction] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const { cards } = await proposeCards({
        turns: [{ toolCalls: [{ name: 'delete_transaction', arguments: { id: transaction.id } }] }, { text: 'Done.' }],
      });
      const card = cardFor({ cards, toolName: 'delete_transaction' });
      expect(card).toMatchObject({ danger: 'destructive', confirmation: { mode: 'confirm' } });

      const missing = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 1 } });
      const wrong = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: 'yes' },
      });
      expect(missing.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(wrong.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);

      const approved = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: 'confirm' },
      });

      expect(approved.statusCode).toBe(200);
      expect(await helpers.getTransactions({ raw: true })).toEqual([]);
    });

    it('needs an amber egress card to repeat its host', async () => {
      const created = await helpers.createCustomCurrency({ payload: { code: 'XYZ', name: 'XYZ', decimals: 6 } });
      expect(created.statusCode).toBe(201);
      global.mswMockServer.use(
        http.get('https://rates.example.test/price/:code', () => HttpResponse.json({ data: { price: 1.5 } })),
      );
      const { cards } = await proposeCards({
        turns: [
          {
            toolCalls: [
              { id: 'call_find', name: 'find_capabilities', arguments: { query: 'set currency rate source' } },
            ],
          },
          {
            toolCalls: [
              {
                id: 'call_source',
                name: 'set_currency_rate_source',
                arguments: {
                  code: 'XYZ',
                  rateSource: 'http',
                  config: {
                    urlTemplate: 'https://rates.example.test/price/{code}?day={date}&quote={quote}',
                    jsonPath: 'data.price',
                    quoteCurrency: global.BASE_CURRENCY_CODE,
                  },
                },
              },
            ],
          },
          { text: 'Done.' },
        ],
      });
      const card = cardFor({ cards, toolName: 'set_currency_rate_source' });
      expect(card).toMatchObject({ egress: { host: 'rates.example.test' }, safe: false });

      const missing = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 1 } });
      const plain = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: 'confirm' },
      });
      const otherHost = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: 'attacker.example' },
      });
      for (const refused of [missing, plain, otherHost]) expect(refused.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getChatProposal({ proposalId: card.id, raw: true })).status).toBe('pending');

      const approved = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: 'Rates.Example.test' },
      });

      expect(approved.statusCode).toBe(200);
      expect(approved.body.response.card.status).toBe('applied');
    });
  });

  describe('freshness', () => {
    it('answers 409 stale when only the other leg of a deleted transfer was edited', async () => {
      const { base, opposite } = await createTransfer();
      const { cards } = await proposeDelete({ id: base.id });
      const card = cardFor({ cards, toolName: 'delete_transaction' });
      await helpers.bulkUpdateTransactions({
        payload: { transactionIds: [opposite.id], note: 'Edited elsewhere' },
        raw: true,
      });

      const stale = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: '2' },
      });

      expect(stale.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(errorOf({ response: stale }).details).toMatchObject({
        reason: 'stale',
        stale: { reasonKey: 'chat.stale.updated' },
      });
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(2);
    });

    it('answers 409 stale with the diff when the target was edited through REST, and applies after a refresh', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [transaction] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, note: 'Original' }),
        raw: true,
      });
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'update_transaction', arguments: { id: transaction.id, note: 'From chat' } }] },
          { text: 'Done.' },
        ],
      });
      const card = cardFor({ cards, toolName: 'update_transaction' });
      await helpers.updateTransaction({ id: transaction.id, payload: { note: 'Edited elsewhere' }, raw: true });

      const stale = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 1 } });

      expect(stale.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(errorOf({ response: stale }).details).toMatchObject({
        reason: 'stale',
        card: { id: card.id, status: 'stale' },
        stale: { reasonKey: 'chat.stale.updated', before: expect.any(String), after: expect.any(String) },
      });
      expect(await helpers.getTransactionById({ id: transaction.id, raw: true })).toMatchObject({
        note: 'Edited elsewhere',
      });

      const refreshed = await helpers.refreshChatProposal({ proposalId: card.id, raw: true });
      expect(refreshed).toMatchObject({ status: 'pending', revision: 2 });
      expect(refreshed.fields.find((field) => field.path === 'note')).toMatchObject({
        value: 'From chat',
        before: 'Edited elsewhere',
      });

      const approved = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 2 } });
      expect(approved.statusCode).toBe(200);
      expect(await helpers.getTransactionById({ id: transaction.id, raw: true })).toMatchObject({ note: 'From chat' });
    });

    it('answers 409 stale when the base currency is not the one the card was previewed against', async () => {
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'create_category', arguments: { name: 'Chat Base', color: '#4CAF50' } }] },
          { text: 'Done.' },
        ],
      });
      const card = cardFor({ cards, toolName: 'create_category' });
      const row = await ChatProposals.findByPk(card.id);
      await row!.update({ snapshot: { ...row!.snapshot!, baseCurrencyCode: 'XXX' } });

      const stale = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 1 } });

      expect(stale.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(errorOf({ response: stale }).details).toMatchObject({
        reason: 'stale',
        stale: { reasonKey: 'chat.stale.baseCurrency', before: 'XXX', after: global.BASE_CURRENCY_CODE },
      });
      expect((await helpers.getCategoriesList()).some((item) => item.name === 'Chat Base')).toBe(false);
    });

    it('answers 423 while a base-currency change is in progress, and leaves the card pending', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'create_category', arguments: { name: 'Chat Locked', color: '#4CAF50' } }] },
          { text: 'Done.' },
        ],
      });
      const card = cardFor({ cards, toolName: 'create_category' });
      await redisClient.set(buildLockKey(account.userId), 'test-lock');

      try {
        const locked = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 1 } });
        expect(locked.statusCode).toBe(ERROR_CODES.Locked);
        expect(errorOf({ response: locked }).code).toBe(API_ERROR_CODES.baseCurrencyChangeInProgress);
      } finally {
        await redisClient.del(buildLockKey(account.userId));
      }

      expect((await helpers.getChatProposal({ proposalId: card.id, raw: true })).status).toBe('pending');
    });
  });

  describe('standalone cards', () => {
    it('refuses an import-batch card without its typed count and leaves it unclaimed', async () => {
      const summary = await importBatch();
      const { cards } = await proposeDeleteBatch(summary.batchId);
      const card = cardFor({ cards, toolName: 'delete_import_batch' });
      expect(card.confirmation).toEqual({ mode: 'typed', phrase: '2' });

      const missing = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 1 } });

      expect(missing.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getChatProposal({ proposalId: card.id, raw: true })).status).toBe('pending');
      expect(await helpers.getTransactions({ batchId: summary.batchId, raw: true })).toHaveLength(2);
    });

    it('answers 409 stale for an import-batch card whose batch changed, and leaves it unclaimed', async () => {
      const summary = await importBatch();
      const { cards } = await proposeDeleteBatch(summary.batchId);
      const card = cardFor({ cards, toolName: 'delete_import_batch' });
      await helpers.deleteTransaction({ id: summary.newTransactionIds[0] });

      const stale = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: '2' },
      });

      expect(stale.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(errorOf({ response: stale }).details).toMatchObject({ reason: 'stale' });
      expect((await helpers.getChatProposal({ proposalId: card.id, raw: true })).status).toBe('stale');
      expect(await helpers.getTransactions({ batchId: summary.batchId, raw: true })).toHaveLength(1);
    });

    it('answers stale for a base-currency card proposed against another base currency, and never claims it', async () => {
      await helpers.createAccount({ raw: true });
      const target = global.BASE_CURRENCY_CODE === 'EUR' ? 'USD' : 'EUR';
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ id: 'call_find', name: 'find_capabilities', arguments: { query: 'change base currency' } }] },
          { toolCalls: [{ id: 'call_base', name: 'change_base_currency', arguments: { newCurrencyCode: target } }] },
          { text: 'Done.' },
        ],
      });
      const card = cardFor({ cards, toolName: 'change_base_currency' });
      const row = await ChatProposals.findByPk(card.id);
      await row!.update({ snapshot: { ...row!.snapshot!, baseCurrencyCode: 'XXX' } });

      const stale = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 1, confirmation: card.confirmation.phrase ?? 'confirm' },
      });

      expect(stale.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(errorOf({ response: stale }).details).toMatchObject({
        reason: 'stale',
        stale: { reasonKey: 'chat.stale.baseCurrency' },
      });
      expect((await helpers.getChatProposal({ proposalId: card.id, raw: true })).status).toBe('stale');
    });
  });

  describe('arguments', () => {
    it('refuses a bulk delete edited to empty filters on the edit', async () => {
      const account = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'bulk_delete_transactions', arguments: { filters: { accountIds: [account.id] } } }] },
          { text: 'Done.' },
        ],
      });
      const bulk = cardFor({ cards, toolName: 'bulk_delete_transactions' });

      const edited = await helpers.editChatProposal({
        proposalId: bulk.id,
        payload: { revision: 1, args: { filters: {} } },
      });

      expect(edited.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getChatProposal({ proposalId: bulk.id, raw: true })).revision).toBe(1);
    });
  });

  describe('who may approve', () => {
    it('answers 404 to another user for a card that is not theirs', async () => {
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'create_category', arguments: { name: 'Chat Private', color: '#4CAF50' } }] },
          { text: 'Done.' },
        ],
      });
      const card = cardFor({ cards, toolName: 'create_category' });
      const second = await helpers.signUpSecondUser();

      const approved = await helpers.asUser({
        cookies: second.cookies,
        fn: () => helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 1 } }),
      });

      expect(approved.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(helpers.errorMessage({ response: approved })).toBe('Chat card not found');
      expect((await helpers.getChatProposal({ proposalId: card.id, raw: true })).status).toBe('pending');
    });

    it('answers 403 to a demo user on approve, approve-all and edit', async () => {
      const demo = await provisionDemoUser();

      const [approve, approveAll, edit] = await helpers.asUser({
        cookies: demo.cookies,
        fn: async () => [
          await helpers.approveChatProposal({ proposalId: OTHER_ID, payload: { revision: 1 } }),
          await helpers.approveAllChatMessage({ messageId: OTHER_ID, payload: { revisions: {} } }),
          await helpers.editChatProposal({ proposalId: OTHER_ID, payload: { revision: 1, args: { name: 'x' } } }),
        ],
      });

      expect([approve.statusCode, approveAll.statusCode, edit.statusCode]).toEqual([403, 403, 403]);
    }, 60_000);
  });
});
