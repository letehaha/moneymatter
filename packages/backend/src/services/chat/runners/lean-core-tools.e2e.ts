import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { cardFor, proposeCards } from '@tests/helpers/chat-cards';
import { createFirstConnection } from '@tests/helpers/user-settings';
import { createChatScript, failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';

import { CHAT_WRITE_PRELOAD_TOOLS } from '../policies/core-tools';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

type Requests = Awaited<ReturnType<typeof proposeCards>>['script']['requests'];

const offeredIn = ({ requests, index }: { requests: Requests; index: number }) =>
  new Set((requests[index]?.tools ?? []).map((tool) => tool.function.name));

const transactionArgs = ({ accountId, categoryId }: { accountId: string; categoryId: string }) => ({
  accountId,
  categoryId,
  amount: 12,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: PAYMENT_TYPES.creditCard,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  note: 'Coffee',
});

describe('lean core tools', () => {
  it('offers no write tool on an answer turn, and a change finds its tool and reaches a card in one extra step', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: 'Coffee', color: '#795548', raw: true });

    const { script, cards } = await proposeCards({
      text: 'log 12 coffee',
      turns: [
        { toolCalls: [{ id: 'call_find', name: 'find_capabilities', arguments: { query: 'log an expense' } }] },
        {
          toolCalls: [
            {
              name: 'create_transaction',
              arguments: transactionArgs({ accountId: account.id, categoryId: category.id }),
            },
          ],
        },
        { text: 'Done.' },
      ],
    });

    for (const name of CHAT_WRITE_PRELOAD_TOOLS)
      expect([name, offeredIn({ requests: script.requests, index: 0 }).has(name)]).toEqual([name, false]);
    expect(offeredIn({ requests: script.requests, index: 0 }).has('get_accounts')).toBe(true);
    expect(offeredIn({ requests: script.requests, index: 0 }).has('find_capabilities')).toBe(true);
    // The step after the search offers what it found.
    expect(offeredIn({ requests: script.requests, index: 1 }).has('create_transaction')).toBe(true);
    expect(script.requests).toHaveLength(3);
    expect(cardFor({ cards, toolName: 'create_transaction' })).toMatchObject({ status: 'pending', kind: 'create' });
  });

  it('starts a turn with an attachment with the write tools offered, so the log needs no search', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: 'Coffee', color: '#795548', raw: true });
    await createFirstConnection();
    const thread = await helpers.createChatThread({ raw: true });
    const script = createChatScript({
      turns: [
        {
          toolCalls: [
            {
              name: 'create_transaction',
              arguments: transactionArgs({ accountId: account.id, categoryId: category.id }),
            },
          ],
        },
        { text: 'Done.' },
      ],
    });
    global.mswMockServer.use(script.handler);
    const upload = await helpers.uploadChatAttachment({
      threadId: thread.id,
      file: Buffer.from('date,amount\n2026-10-01,12.00\n'),
      filename: 'statement.csv',
    });

    const sent = await helpers.sendChatMessage({
      threadId: thread.id,
      payload: { text: 'log this', attachmentIds: [upload.attachment!.id] },
      raw: true,
    });
    await helpers.getChatRunEvents({ runId: sent.runId });
    expect(script.requests).toHaveLength(2);

    for (const name of CHAT_WRITE_PRELOAD_TOOLS)
      expect([name, offeredIn({ requests: script.requests, index: 0 }).has(name)]).toEqual([name, true]);
  });

  it('keeps the writes on offer in a thread that already has cards', async () => {
    const account = await helpers.createAccount({ raw: true });
    const category = await helpers.addCustomCategory({ name: 'Coffee', color: '#795548', raw: true });
    const first = await proposeCards({
      turns: [
        { toolCalls: [{ id: 'call_find', name: 'find_capabilities', arguments: { query: 'create tag' } }] },
        { toolCalls: [{ name: 'create_tag', arguments: { name: 'Coffee', color: '#aa0000' } }] },
        { text: 'Done.' },
      ],
    });

    const second = await proposeCards({
      threadId: first.threadId,
      turns: [
        {
          toolCalls: [
            {
              name: 'create_transaction',
              arguments: transactionArgs({ accountId: account.id, categoryId: category.id }),
            },
          ],
        },
        { text: 'Done.' },
      ],
    });

    expect(offeredIn({ requests: second.script.requests, index: 0 }).has('create_transaction')).toBe(true);
    expect(second.script.requests).toHaveLength(2);
    expect(cardFor({ cards: second.cards, toolName: 'create_transaction' }).status).toBe('pending');
  });
});
