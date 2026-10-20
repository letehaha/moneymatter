import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, type ChatProposalCard } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ChatMessages from '@models/chat-messages.model';
import ChatProposals from '@models/chat-proposals.model';
import { connection } from '@models/index';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { cardFor, proposalRefsIn, proposeCards } from '@tests/helpers/chat-cards';
import { createChatScript, failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';
import { http, HttpResponse } from 'msw';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

const DAY_MS = 24 * 60 * 60 * 1000;
const CARD_NOT_FOUND = 'Chat card not found';

const errorOf = ({ response }: { response: { body: { response: unknown } } }) =>
  response.body.response as { message: string; code: string; details?: Record<string, any> };

const transactionArgs = ({ accountId, ...rest }: { accountId: string } & Record<string, unknown>) => ({
  accountId,
  amount: 4.5,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: PAYMENT_TYPES.creditCard,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  ...rest,
});

const categoryAndTransaction = ({ accountId }: { accountId: string }) => [
  {
    toolCalls: [{ id: 'call_category', name: 'create_category', arguments: { name: 'Chat Dining', color: '#4CAF50' } }],
  },
  (body: Parameters<typeof proposalRefsIn>[0]['body']) => ({
    toolCalls: [
      {
        id: 'call_tx',
        name: 'create_transaction',
        arguments: transactionArgs({ accountId, categoryId: proposalRefsIn({ body })[0] }),
      },
    ],
  }),
  { text: 'Done.' },
];

const oneCategory = ({ name }: { name: string }) => [
  { toolCalls: [{ name: 'create_category', arguments: { name, color: '#4CAF50' } }] },
  { text: 'Done.' },
];

/** Polls until a statement that locks card rows waits on another transaction's row lock. */
const waitForBlockedCardLock = async () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [blocked] = (await connection.sequelize.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%' AND query LIKE '%ChatProposals%'
         AND pid <> pg_backend_pid()`,
    )) as [unknown[], unknown];
    if (blocked.length) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The reject never waited on the card lock');
};

const proposeNoteUpdate = async () => {
  const account = await helpers.createAccount({ raw: true });
  const [transaction] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId: account.id, note: 'Original' }),
    raw: true,
  });
  const proposed = await proposeCards({
    turns: [
      { toolCalls: [{ name: 'update_transaction', arguments: { id: transaction.id, note: 'From chat' } }] },
      { text: 'Done.' },
    ],
  });
  return { transaction, card: cardFor({ cards: proposed.cards, toolName: 'update_transaction' }) };
};

describe('Chat card actions', () => {
  describe('GET /chat/proposals/:id', () => {
    it('returns the card', async () => {
      const { cards } = await proposeCards({ turns: oneCategory({ name: 'Chat Read' }) });
      const category = cardFor({ cards, toolName: 'create_category' });

      const card = await helpers.getChatProposal({ proposalId: category.id, raw: true });

      expect(card).toMatchObject({ id: category.id, status: 'pending', revision: 1, toolName: 'create_category' });
    });

    it('answers 404 for a card that does not exist', async () => {
      const response = await helpers.getChatProposal({ proposalId: '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a' });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(helpers.errorMessage({ response })).toBe(CARD_NOT_FOUND);
    });

    it('marks a card past its lifetime as expired, and approving it answers 409', async () => {
      const { cards } = await proposeCards({ turns: oneCategory({ name: 'Chat Late' }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      await ChatProposals.update({ expiresAt: new Date(Date.now() - DAY_MS) }, { where: { id: category.id } });

      const card = await helpers.getChatProposal({ proposalId: category.id, raw: true });
      const approved = await helpers.approveChatProposal({ proposalId: category.id, payload: { revision: 1 } });

      expect(card.status).toBe('expired');
      expect(approved.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(errorOf({ response: approved }).details).toMatchObject({ reason: 'expired' });
      expect((await helpers.getCategoriesList()).some((item) => item.name === 'Chat Late')).toBe(false);
    });

    it('expires a card the approval finds past its lifetime even when nobody read it first', async () => {
      const { cards } = await proposeCards({ turns: oneCategory({ name: 'Chat Later' }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      await ChatProposals.update({ expiresAt: new Date(Date.now() - DAY_MS) }, { where: { id: category.id } });

      const approved = await helpers.approveChatProposal({ proposalId: category.id, payload: { revision: 1 } });

      expect(approved.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(await ChatProposals.findByPk(category.id)).toMatchObject({ status: 'expired' });
    });
  });

  describe('GET /chat/threads/:id cards', () => {
    it('returns the current card of every proposal part on the page, by id', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards, threadId } = await proposeCards({ turns: categoryAndTransaction({ accountId: account.id }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const tx = cardFor({ cards, toolName: 'create_transaction' });
      await helpers.rejectChatProposal({ proposalId: category.id });

      const page = await helpers.getChatThread({ threadId, raw: true });

      expect(Object.keys(page.cards).sort()).toEqual([category.id, tx.id].sort());
      expect(page.cards[category.id]).toMatchObject({
        id: category.id,
        status: 'rejected',
        toolName: 'create_category',
      });
      expect(page.cards[tx.id]).toMatchObject({ id: tx.id, status: 'blocked', toolName: 'create_transaction' });
      expect(page.cards[tx.id]!.dependsOn.map((parent) => parent.id)).toEqual([category.id]);
    });

    it('returns only the cards of the messages on the requested page', async () => {
      const first = await proposeCards({ turns: oneCategory({ name: 'Chat Page One' }) });
      const second = await proposeCards({ turns: oneCategory({ name: 'Chat Page Two' }), threadId: first.threadId });
      const firstCard = cardFor({ cards: first.cards, toolName: 'create_category' });
      const secondCard = cardFor({ cards: second.cards, toolName: 'create_category' });

      const latest = await helpers.getChatThread({ threadId: first.threadId, limit: 2, raw: true });
      const older = await helpers.getChatThread({
        threadId: first.threadId,
        limit: 2,
        before: latest.messages[0]!.id,
        raw: true,
      });

      expect(Object.keys(latest.cards)).toEqual([secondCard.id]);
      expect(Object.keys(older.cards)).toEqual([firstCard.id]);
    });

    it('shows a pending card past its lifetime as expired', async () => {
      const { cards, threadId } = await proposeCards({ turns: oneCategory({ name: 'Chat Page Late' }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      await ChatProposals.update({ expiresAt: new Date(Date.now() - DAY_MS) }, { where: { id: category.id } });

      const page = await helpers.getChatThread({ threadId, raw: true });

      expect(page.cards[category.id]).toMatchObject({ status: 'expired' });
      expect(await ChatProposals.findByPk(category.id)).toMatchObject({ status: 'expired' });
    });

    it('returns no cards for a thread without proposals', async () => {
      const thread = await helpers.createChatThread({ raw: true });

      const page = await helpers.getChatThread({ threadId: thread.id, raw: true });

      expect(page.cards).toEqual({});
    });
  });

  describe('POST /chat/proposals/:id/reject', () => {
    it('rejects a card and blocks the cards that depend on it', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards } = await proposeCards({ turns: categoryAndTransaction({ accountId: account.id }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const tx = cardFor({ cards, toolName: 'create_transaction' });

      const rejected = await helpers.rejectChatProposal({ proposalId: category.id });

      expect(rejected.statusCode).toBe(200);
      expect(rejected.body.response.card).toMatchObject({ id: category.id, status: 'rejected' });
      expect(rejected.body.response.cards.find((card) => card.id === tx.id)).toMatchObject({ status: 'blocked' });
      const approved = await helpers.approveChatProposal({ proposalId: tx.id, payload: { revision: 1 } });
      expect(approved.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(await helpers.getTransactions({ raw: true })).toEqual([]);
    });

    it('answers the rejected card again when it is rejected twice, and refuses to reject an applied one', async () => {
      const { cards } = await proposeCards({
        turns: [
          {
            toolCalls: [
              { name: 'create_category', arguments: { name: 'Chat Twice', color: '#4CAF50' } },
              { name: 'create_category', arguments: { name: 'Chat Kept', color: '#4CAF50' } },
            ],
          },
          { text: 'Done.' },
        ],
      });
      const twice = cardFor({ cards, toolName: 'create_category', index: 0 });
      const kept = cardFor({ cards, toolName: 'create_category', index: 1 });
      await helpers.rejectChatProposal({ proposalId: twice.id });
      await helpers.approveChatProposal({ proposalId: kept.id, payload: { revision: 1 } });

      const again = await helpers.rejectChatProposal({ proposalId: twice.id });
      const late = await helpers.rejectChatProposal({ proposalId: kept.id });

      expect(again.statusCode).toBe(200);
      expect(again.body.response.card.status).toBe('rejected');
      expect(late.statusCode).toBe(ERROR_CODES.ConflictError);
      expect((await helpers.getChatProposal({ proposalId: kept.id, raw: true })).status).toBe('applied');
    });

    it('takes the card locks in id order, so a reject waiting on a lower card holds none of the higher ones', async () => {
      const { cards } = await proposeCards({
        turns: [
          {
            toolCalls: [
              { name: 'create_category', arguments: { name: 'Chat Lock A', color: '#4CAF50' } },
              { name: 'create_category', arguments: { name: 'Chat Lock B', color: '#4CAF50' } },
            ],
          },
          { text: 'Done.' },
        ],
      });
      const [low, high] = cards.map((card) => card.id).toSorted();

      // Another transaction (an approval walking its chain) holds the lower card.
      const holder = await connection.sequelize.transaction();
      await ChatProposals.findOne({ where: { id: low }, transaction: holder, lock: holder.LOCK.UPDATE });

      const reject = helpers.rejectChatProposal({ proposalId: high! });
      await waitForBlockedCardLock();

      // The reject is queued behind the lower card. It must not hold the higher one meanwhile, or an
      // approval that holds the higher card and wants the lower one would deadlock with it.
      const probe = await connection.sequelize.transaction();
      try {
        await connection.sequelize.query(`SELECT 1 FROM "ChatProposals" WHERE id = :id FOR UPDATE NOWAIT`, {
          replacements: { id: high },
          transaction: probe,
        });
      } finally {
        await probe.rollback();
        await holder.commit();
      }

      const rejected = await reject;
      expect(rejected.statusCode).toBe(200);
      expect(rejected.body.response.card).toMatchObject({ id: high, status: 'rejected' });
    });

    it('does not let a rejected card be approved', async () => {
      const { cards } = await proposeCards({ turns: oneCategory({ name: 'Chat No' }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      await helpers.rejectChatProposal({ proposalId: category.id });

      const approved = await helpers.approveChatProposal({ proposalId: category.id, payload: { revision: 1 } });

      expect(approved.statusCode).toBe(ERROR_CODES.ConflictError);
      expect((await helpers.getCategoriesList()).some((item) => item.name === 'Chat No')).toBe(false);
    });
  });

  describe('PATCH /chat/proposals/:id', () => {
    it('re-validates and re-previews an edit, increments the revision and marks the card edited', async () => {
      const { transaction, card } = await proposeNoteUpdate();
      expect(card.editedByUser).toBe(false);

      const edited = await helpers.editChatProposal({
        proposalId: card.id,
        payload: { revision: 1, args: { id: transaction.id, note: 'Edited by me' } },
      });

      expect(edited.statusCode).toBe(200);
      expect(edited.body.response).toMatchObject({ id: card.id, status: 'pending', revision: 2, editedByUser: true });
      expect(edited.body.response.fields.find((field) => field.path === 'note')).toMatchObject({
        value: 'Edited by me',
        before: 'Original',
      });
      const approved = await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 2 } });
      expect(approved.statusCode).toBe(200);
      expect(await helpers.getTransactionById({ id: transaction.id, raw: true })).toMatchObject({
        note: 'Edited by me',
      });
    });

    it('answers 409 with the current card when the edit starts from an old revision', async () => {
      const { transaction, card } = await proposeNoteUpdate();
      await helpers.editChatProposal({
        proposalId: card.id,
        payload: { revision: 1, args: { id: transaction.id, note: 'First' } },
      });

      const late = await helpers.editChatProposal({
        proposalId: card.id,
        payload: { revision: 1, args: { id: transaction.id, note: 'Second' } },
      });

      expect(late.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(errorOf({ response: late }).details).toMatchObject({ reason: 'revision', card: { revision: 2 } });
    });

    it('edits a card whose parent was approved on its own, and applies it with the parent’s real id', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards } = await proposeCards({ turns: categoryAndTransaction({ accountId: account.id }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const tx = cardFor({ cards, toolName: 'create_transaction' });
      const approvedParent = await helpers.approveChatProposal({ proposalId: category.id, payload: { revision: 1 } });
      expect(approvedParent.statusCode).toBe(200);

      // The child still holds the ref to its parent, and the frontend sends the whole argument set back.
      const edited = await helpers.editChatProposal({
        proposalId: tx.id,
        payload: {
          revision: 1,
          args: transactionArgs({ accountId: account.id, categoryId: `$proposal:${category.id}`, note: 'Edited' }),
        },
      });

      expect(edited.statusCode).toBe(200);
      expect(edited.body.response).toMatchObject({ id: tx.id, status: 'pending', revision: 2, editedByUser: true });
      const approved = await helpers.approveChatProposal({ proposalId: tx.id, payload: { revision: 2 } });
      expect(approved.statusCode).toBe(200);
      const [created] = await helpers.getTransactions({ raw: true });
      const realCategory = (await helpers.getCategoriesList()).find((item) => item.name === 'Chat Dining')!;
      expect(created).toMatchObject({ note: 'Edited', categoryId: realCategory.id });
    });

    it('answers 422 for arguments that fail the tool schema, and for ones that fail its validator', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards } = await proposeCards({
        turns: [
          { toolCalls: [{ name: 'create_transaction', arguments: transactionArgs({ accountId: account.id }) }] },
          { text: 'Done.' },
        ],
      });
      const card = cardFor({ cards, toolName: 'create_transaction' });

      const schema = await helpers.editChatProposal({
        proposalId: card.id,
        payload: { revision: 1, args: transactionArgs({ accountId: account.id, amount: 'a lot' }) },
      });
      // An original amount without its currency is a cross-field rule only `validateArgs` knows.
      const validator = await helpers.editChatProposal({
        proposalId: card.id,
        payload: { revision: 1, args: transactionArgs({ accountId: account.id, originalAmount: 5 }) },
      });

      expect(schema.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(validator.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getChatProposal({ proposalId: card.id, raw: true })).revision).toBe(1);
    });

    it('recomputes the confirmation an edit turns into an egress card', async () => {
      await helpers.createCustomCurrency({ payload: { code: 'XYZ', name: 'XYZ', decimals: 6 } });
      const { cards } = await proposeCards({
        turns: [
          {
            toolCalls: [
              { id: 'call_find', name: 'find_capabilities', arguments: { query: 'set currency rate source' } },
            ],
          },
          {
            toolCalls: [
              { id: 'call_source', name: 'set_currency_rate_source', arguments: { code: 'XYZ', rateSource: 'manual' } },
            ],
          },
          { text: 'Done.' },
        ],
      });
      const card = cardFor({ cards, toolName: 'set_currency_rate_source' });
      expect(card).toMatchObject({ confirmation: { mode: 'none' }, safe: true });
      expect(card.egress).toBeUndefined();

      const edited = await helpers.editChatProposal({
        proposalId: card.id,
        payload: {
          revision: 1,
          args: {
            code: 'XYZ',
            rateSource: 'http',
            config: {
              urlTemplate: 'https://rates.example.test/{code}?d={date}',
              jsonPath: 'data.price',
              quoteCurrency: global.BASE_CURRENCY_CODE,
            },
          },
        },
      });

      expect(edited.statusCode).toBe(200);
      expect(edited.body.response).toMatchObject({
        revision: 2,
        confirmation: { mode: 'confirm' },
        egress: { host: 'rates.example.test' },
        safe: false,
      });
    });

    it('answers 404 to another user', async () => {
      const { cards } = await proposeCards({ turns: oneCategory({ name: 'Chat Hidden' }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const second = await helpers.signUpSecondUser();

      const edited = await helpers.asUser({
        cookies: second.cookies,
        fn: () =>
          helpers.editChatProposal({ proposalId: category.id, payload: { revision: 1, args: { name: 'Stolen' } } }),
      });

      expect(edited.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(helpers.errorMessage({ response: edited })).toBe(CARD_NOT_FOUND);
    });
  });

  describe('POST /chat/proposals/:id/comment', () => {
    it('starts a run whose history includes the card, and the replacement card supersedes the old one', async () => {
      const { cards, threadId } = await proposeCards({ turns: oneCategory({ name: 'Chat Food' }) });
      const old = cardFor({ cards, toolName: 'create_category' });
      const replacement = createChatScript({
        turns: [
          {
            toolCalls: [
              {
                name: 'create_category',
                arguments: { name: 'Chat Groceries', color: '#4CAF50', _chat: { replaces: old.id } },
              },
            ],
          },
          { text: 'Done.' },
        ],
      });
      global.mswMockServer.use(replacement.handler);

      const commented = await helpers.commentOnChatProposal({ proposalId: old.id, text: 'Call it Groceries instead' });

      expect(commented.statusCode).toBe(202);
      const { runId, userMessageId } = commented.body.response;
      const stream = await helpers.getChatRunEvents({ runId });
      expect(stream.events.at(-1)).toMatchObject({ type: 'run.finished', status: 'complete' });

      const seen = JSON.stringify(replacement.requests[0]!.messages);
      expect(seen).toContain(`Comment on proposal ${old.id}`);
      expect(seen).toContain('Call it Groceries instead');

      expect((await helpers.getChatProposal({ proposalId: old.id, raw: true })).status).toBe('superseded');
      const newCard = stream.events
        .flatMap((event) => (event.type === 'proposal.upserted' ? [event.card] : []))
        .find((card) => card.status === 'pending') as ChatProposalCard;
      expect(newCard).toMatchObject({ toolName: 'create_category', status: 'pending' });
      expect(newCard.fields.find((field) => field.path === 'name')!.value).toBe('Chat Groceries');

      const userMessage = await ChatMessages.findByPk(userMessageId);
      expect(userMessage!.parts).toEqual([
        { type: 'cardComment', id: expect.any(String), proposalId: old.id, text: 'Call it Groceries instead' },
      ]);
      expect(userMessage!.plainText).toBe('Call it Groceries instead');
      expect(userMessage!.threadId).toBe(threadId);
    });

    it('answers 404 for another user’s card and 422 for an empty comment', async () => {
      const { cards } = await proposeCards({ turns: oneCategory({ name: 'Chat Comment' }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const second = await helpers.signUpSecondUser();

      const foreign = await helpers.asUser({
        cookies: second.cookies,
        fn: () => helpers.commentOnChatProposal({ proposalId: category.id, text: 'Hi' }),
      });
      const empty = await helpers.commentOnChatProposal({ proposalId: category.id, text: '   ' });

      expect(foreign.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(helpers.errorMessage({ response: foreign })).toBe(CARD_NOT_FOUND);
      expect(empty.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('POST /chat/messages/:id/approve-all', () => {
    it('applies the safe cards of a message and names the ones it leaves', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [toDelete] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const [toUpdate] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, note: 'Original' }),
        raw: true,
      });
      await helpers.createCustomCurrency({ payload: { code: 'XYZ', name: 'XYZ', decimals: 6 } });
      global.mswMockServer.use(
        http.get('https://rates.example.test/price/:code', () => HttpResponse.json({ data: { price: 1.5 } })),
      );
      const { cards, messageId } = await proposeCards({
        turns: [
          {
            toolCalls: [
              { id: 'call_a', name: 'create_category', arguments: { name: 'Chat Safe A', color: '#4CAF50' } },
              { id: 'call_b', name: 'create_category', arguments: { name: 'Chat Safe B', color: '#4CAF50' } },
              {
                id: 'call_unsure',
                name: 'create_tag',
                arguments: {
                  name: 'Chat Unsure',
                  color: '#aa0000',
                  _chat: { uncertain: [{ field: 'color', reason: 'guessedFromHistory' }] },
                },
              },
              { id: 'call_delete', name: 'delete_transaction', arguments: { id: toDelete.id } },
              { id: 'call_update', name: 'update_transaction', arguments: { id: toUpdate.id, note: 'From chat' } },
              { id: 'call_find', name: 'find_capabilities', arguments: { query: 'set currency rate source' } },
            ],
          },
          {
            toolCalls: [
              {
                id: 'call_egress',
                name: 'set_currency_rate_source',
                arguments: {
                  code: 'XYZ',
                  rateSource: 'http',
                  config: { urlTemplate: 'https://rates.example.test/price/{code}?day={date}', jsonPath: 'data.price' },
                },
              },
            ],
          },
          { text: 'Done.' },
        ],
      });
      const safeA = cardFor({ cards, toolName: 'create_category', index: 0 });
      const safeB = cardFor({ cards, toolName: 'create_category', index: 1 });
      const unsure = cardFor({ cards, toolName: 'create_tag' });
      const red = cardFor({ cards, toolName: 'delete_transaction' });
      const update = cardFor({ cards, toolName: 'update_transaction' });
      const egress = cardFor({ cards, toolName: 'set_currency_rate_source' });
      expect(
        cards
          .filter((card) => card.safe)
          .map((card) => card.id)
          .toSorted(),
      ).toEqual([safeA.id, safeB.id, update.id].toSorted());
      // The update goes stale after the user saw the card.
      await helpers.updateTransaction({ id: toUpdate.id, payload: { note: 'Edited elsewhere' }, raw: true });

      const response = await helpers.approveAllChatMessage({
        messageId,
        payload: { revisions: Object.fromEntries(cards.map((card) => [card.id, card.revision])) },
      });

      expect(response.statusCode).toBe(200);
      const outcomes = Object.fromEntries(
        response.body.response.results.map((result) => [result.proposalId, result.outcome]),
      );
      expect(outcomes).toEqual({
        [safeA.id]: 'applied',
        [safeB.id]: 'applied',
        [update.id]: 'stale',
        [unsure.id]: 'skipped',
        [red.id]: 'skipped',
        [egress.id]: 'skipped',
      });
      expect(response.body.response.cards.map((card) => [card.id, card.status]).toSorted()).toEqual(
        [
          [safeA.id, 'applied'],
          [safeB.id, 'applied'],
          [unsure.id, 'pending'],
          [red.id, 'pending'],
          [update.id, 'stale'],
          [egress.id, 'pending'],
        ].toSorted(),
      );
      const categories = (await helpers.getCategoriesList()).map((item) => item.name);
      expect(categories).toEqual(expect.arrayContaining(['Chat Safe A', 'Chat Safe B']));
      expect((await helpers.getTags({ raw: true })).some((tag) => tag.name === 'Chat Unsure')).toBe(false);
      expect(await helpers.getTransactionById({ id: toDelete.id, raw: true })).not.toBeNull();
      expect(await helpers.getTransactionById({ id: toUpdate.id, raw: true })).toMatchObject({
        note: 'Edited elsewhere',
      });
    });

    it('applies a chain once when both its cards are safe', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { cards, messageId } = await proposeCards({ turns: categoryAndTransaction({ accountId: account.id }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const tx = cardFor({ cards, toolName: 'create_transaction' });

      const response = await helpers.approveAllChatMessage({
        messageId,
        payload: { revisions: { [category.id]: 1, [tx.id]: 1 } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.response.results.map((result) => result.outcome).toSorted()).toEqual(['applied', 'applied']);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);
      expect((await helpers.getCategoriesList()).filter((item) => item.name === 'Chat Dining')).toHaveLength(1);
    });

    it('answers 404 for another user’s message', async () => {
      const { messageId } = await proposeCards({ turns: oneCategory({ name: 'Chat Mine' }) });
      const second = await helpers.signUpSecondUser();

      const response = await helpers.asUser({
        cookies: second.cookies,
        fn: () => helpers.approveAllChatMessage({ messageId, payload: { revisions: {} } }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(helpers.errorMessage({ response })).toBe('Chat message not found');
    });
  });

  describe('GET /chat/applied', () => {
    it('is empty before anything is applied, pages through applied cards and hides another user’s', async () => {
      expect(await helpers.getChatAppliedCards({ raw: true })).toEqual({ items: [], nextCursor: null });
      const { cards } = await proposeCards({
        turns: [
          {
            toolCalls: [
              { name: 'create_category', arguments: { name: 'Chat Page 1', color: '#4CAF50' } },
              { name: 'create_category', arguments: { name: 'Chat Page 2', color: '#4CAF50' } },
              { name: 'create_category', arguments: { name: 'Chat Page 3', color: '#4CAF50' } },
            ],
          },
          { text: 'Done.' },
        ],
      });
      for (const card of cards) {
        await helpers.approveChatProposal({ proposalId: card.id, payload: { revision: 1 } });
      }

      const first = await helpers.getChatAppliedCards({ limit: 2, raw: true });
      const second = await helpers.getChatAppliedCards({ limit: 2, cursor: first.nextCursor!, raw: true });

      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect([...first.items, ...second.items].map((item) => item.card.id).toSorted()).toEqual(
        cards.map((card) => card.id).toSorted(),
      );

      const other = await helpers.signUpSecondUser();
      const foreign = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.getChatAppliedCards({ raw: true }),
      });
      expect(foreign.items).toEqual([]);
    });
  });

  describe('POST /chat/proposals/:id/refresh', () => {
    it('answers 404 to another user', async () => {
      const { cards } = await proposeCards({ turns: oneCategory({ name: 'Chat Refresh' }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      const second = await helpers.signUpSecondUser();

      const response = await helpers.asUser({
        cookies: second.cookies,
        fn: () => helpers.refreshChatProposal({ proposalId: category.id }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(helpers.errorMessage({ response })).toBe(CARD_NOT_FOUND);
    });

    it('increments the revision of a pending card', async () => {
      const { cards } = await proposeCards({ turns: oneCategory({ name: 'Chat Bump' }) });
      const category = cardFor({ cards, toolName: 'create_category' });

      const refreshed = await helpers.refreshChatProposal({ proposalId: category.id, raw: true });

      expect(refreshed).toMatchObject({ id: category.id, status: 'pending', revision: 2 });
    });

    it('re-previews a transfer delete after its other leg changed, and applies with the fresh snapshot', async () => {
      const from = await helpers.createAccount({ raw: true });
      const to = await helpers.createAccount({ raw: true });
      const [base, opposite] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: from.id, amount: 300 }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 300,
          destinationAccountId: to.id,
        },
        raw: true,
      });
      const { cards } = await proposeCards({
        turns: [{ toolCalls: [{ name: 'delete_transaction', arguments: { id: base.id } }] }, { text: 'Done.' }],
      });
      const card = cardFor({ cards, toolName: 'delete_transaction' });
      await helpers.bulkUpdateTransactions({ payload: { transactionIds: [opposite!.id], note: 'Edited' }, raw: true });

      const refreshed = await helpers.refreshChatProposal({ proposalId: card.id, raw: true });
      const approved = await helpers.approveChatProposal({
        proposalId: card.id,
        payload: { revision: 2, confirmation: '2' },
      });

      expect(refreshed).toMatchObject({ status: 'pending', revision: 2, affected: { count: 2 } });
      expect(approved.statusCode).toBe(200);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);
    });

    it('refuses to refresh an applied card', async () => {
      const { cards } = await proposeCards({ turns: oneCategory({ name: 'Chat Done' }) });
      const category = cardFor({ cards, toolName: 'create_category' });
      await helpers.approveChatProposal({ proposalId: category.id, payload: { revision: 1 } });

      const response = await helpers.refreshChatProposal({ proposalId: category.id });

      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
    });
  });
});
