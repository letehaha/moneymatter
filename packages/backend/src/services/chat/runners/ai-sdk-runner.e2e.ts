import {
  PAYMENT_TYPES,
  SUBSCRIPTION_FREQUENCIES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type ChatMessagePart,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import ChatProposals from '@models/chat-proposals.model';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import {
  createChatScript,
  failOnUnscriptedChatRequests,
  type ChatCompletionRequestBody,
  type ChatScriptTurn,
} from '@tests/mocks/openai-compatible/chat-script';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { CHAT_PROMPT_VERSION } from '../prompt/system-prompt';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

const RECEIPT_PNG = readFileSync(path.join(__dirname, '../../../tests/fixtures/chat/receipt.png'));
const FOREIGN_ID = '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a';

const DONUT = {
  type: 'chart',
  kind: 'donut',
  title: 'Spending in September',
  unit: { kind: 'money', currencyCode: 'USD' },
  slices: [
    { label: 'Food', value: 120 },
    { label: 'Transport', value: 45 },
  ],
};

async function arrange({ turns }: { turns: ChatScriptTurn[] }) {
  await helpers.createFirstConnection();
  const script = createChatScript({ turns });
  global.mswMockServer.use(script.handler);
  return { script, threadId: (await helpers.createChatThread({ raw: true })).id };
}

async function send({
  threadId,
  payload,
}: {
  threadId: string;
  payload: Parameters<typeof helpers.sendChatMessage>[0]['payload'];
}) {
  const sent = await helpers.sendChatMessage({ threadId, payload, raw: true });
  const stream = await helpers.getChatRunEvents({ runId: sent.runId });
  const loaded = await helpers.getChatThread({ threadId, raw: true });
  return { sent, events: stream.events, message: loaded.messages.find((message) => message.id === sent.messageId)! };
}

const partsOfType = <T extends ChatMessagePart['type']>({
  parts,
  type,
}: {
  parts: ChatMessagePart[];
  type: T;
}): Array<Extract<ChatMessagePart, { type: T }>> =>
  parts.filter((part): part is Extract<ChatMessagePart, { type: T }> => part.type === type);

const toolNamesOf = (body: ChatCompletionRequestBody) => body.tools!.map((tool) => tool.function.name);

/** The tool results the model received in one request, in order. */
const toolMessages = ({ body }: { body: ChatCompletionRequestBody }): string[] =>
  (body.messages ?? []).filter((message) => message.role === 'tool').map((message) => String(message.content));

const transactionArgs = ({ accountId, ...rest }: { accountId: string } & Record<string, unknown>) => ({
  accountId,
  amount: 4.5,
  transactionType: TRANSACTION_TYPES.expense,
  paymentType: PAYMENT_TYPES.creditCard,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  ...rest,
});

describe('AI SDK chat runner', () => {
  it('answers a question: reads, writes text, draws a chart, records the calls and sums the usage', async () => {
    const account = await helpers.createAccount({ raw: true });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 12_000,
        time: '2026-09-10T00:00:00.000Z',
      }),
      raw: true,
    });
    const { script, threadId } = await arrange({
      turns: [
        {
          toolCalls: [
            {
              id: 'call_spend',
              name: 'get_spending_by_categories',
              arguments: { startDate: '2026-09-01', endDate: '2026-09-30' },
            },
          ],
          usage: { promptTokens: 1000, completionTokens: 20 },
        },
        {
          text: 'Food leads.',
          toolCalls: [{ id: 'call_chart', name: 'render_chart', arguments: { spec: DONUT } }],
          usage: { promptTokens: 1200, completionTokens: 30, cachedTokens: 400 },
        },
        { text: 'That is the breakdown.', usage: { promptTokens: 1300, completionTokens: 10 } },
      ],
    });

    const { events, message } = await send({ threadId, payload: { text: 'Where did my money go in September?' } });

    expect(events.at(-1)).toMatchObject({ type: 'run.finished', status: 'complete' });
    expect(message).toMatchObject({
      status: 'complete',
      plainText: 'Food leads.\n\nThat is the breakdown.',
      stepCount: 3,
      promptVersion: CHAT_PROMPT_VERSION,
      usage: { inputTokens: 3500, outputTokens: 60, cachedInputTokens: 400 },
    });

    const toolCalls = partsOfType({ parts: message.parts, type: 'toolCall' });
    expect(toolCalls.map((call) => [call.toolName, call.status])).toEqual([
      ['get_spending_by_categories', 'ok'],
      ['render_chart', 'ok'],
    ]);
    expect(toolCalls[0]).toMatchObject({ callId: 'call_spend', args: { startDate: '2026-09-01' } });
    expect(toolCalls[0]!.resultSummary).toEqual(expect.any(String));
    expect(toolCalls[0]!.resultSummary).not.toContain('UNTRUSTED');
    expect(toolCalls[0]!.durationMs).toEqual(expect.any(Number));
    expect(partsOfType({ parts: message.parts, type: 'visual' })).toEqual([
      { type: 'visual', id: expect.any(String), spec: DONUT },
    ]);
    expect(partsOfType({ parts: message.parts, type: 'text' }).map((part) => part.text)).toEqual([
      'Food leads.',
      'That is the breakdown.',
    ]);
    expect((await helpers.getChatThread({ threadId, raw: true })).thread.usage).toMatchObject({
      inputTokens: 3500,
      outputTokens: 60,
    });

    // The model's view: the full system prompt, the core tools plus the chat's own, and the read result wrapped as data.
    const first = script.requests[0]!;
    expect(first.messages![0]).toMatchObject({ role: 'system' });
    expect(String(first.messages![0]!.content)).toContain('Cards are the only way to change data');
    expect(String(first.messages![0]!.content)).toMatch(/Base currency: [A-Z]{3}/);
    const toolNames = first.tools!.map((tool) => tool.function.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'get_spending_by_categories',
        'create_transaction',
        'find_capabilities',
        'ask_clarification',
        'render_chart',
        'read_attachment',
      ]),
    );
    expect(toolNames).not.toContain('delete_account');
    expect(toolMessages({ body: script.requests[1]! })[0]).toMatch(
      /^<<<UNTRUSTED kind=toolResult nonce=[0-9a-f]{32}>>>/,
    );
  });

  it('proposes without prose: retracts the text before the first card, stores no text and creates nothing', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { script, threadId } = await arrange({
      turns: [
        {
          text: 'Let me check',
          toolCalls: [{ id: 'call_cats', name: 'get_categories', arguments: {} }],
        },
        { toolCalls: [{ id: 'call_cat', name: 'create_category', arguments: { name: 'Coffee beans' } }] },
        (body) => {
          const { ref } = JSON.parse(toolMessages({ body }).at(-1)!) as { ref: string };
          return {
            toolCalls: [
              {
                id: 'call_tx',
                name: 'create_transaction',
                arguments: transactionArgs({ accountId: account.id, categoryId: ref }),
              },
            ],
          };
        },
        { text: 'Done, I proposed both.' },
      ],
    });

    const { events, message } = await send({ threadId, payload: { text: 'Log 4.50 for coffee beans' } });

    expect(events.at(-1)).toMatchObject({ type: 'run.finished', status: 'complete' });
    const started = events.find((event) => event.type === 'part.started' && event.part.type === 'text');
    const retracted = events.find((event) => event.type === 'text.retracted');
    expect(started).toBeDefined();
    expect(retracted).toMatchObject({
      type: 'text.retracted',
      partIds: [(started as { part: { id: string } }).part.id],
    });
    expect(helpers.streamedChatText({ events })).toBe('Let me check');

    expect(partsOfType({ parts: message.parts, type: 'text' })).toEqual([]);
    expect(message.plainText).toBeNull();
    expect(partsOfType({ parts: message.parts, type: 'proposal' })).toHaveLength(2);

    const cards = await ChatProposals.findAll({ where: { threadId }, order: [['createdAt', 'ASC']] });
    expect(cards.map((card) => [card.toolName, card.status])).toEqual([
      ['create_category', 'pending'],
      ['create_transaction', 'pending'],
    ]);
    expect(cards[1]!.dependsOn).toEqual([cards[0]!.id]);
    expect(cards[1]!.args.categoryId).toBe(`$proposal:${cards[0]!.id}`);

    expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);
    expect((await helpers.getCategoriesList()).map((category) => category.name)).not.toContain('Coffee beans');
    expect(script.remaining()).toBe(0);
  });

  it('returns a failed validation to the model as a tool error and creates no card', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { script, threadId } = await arrange({
      turns: [
        {
          toolCalls: [
            {
              id: 'call_bad',
              name: 'create_transaction',
              arguments: transactionArgs({ accountId: account.id, originalAmount: 66.42 }),
            },
          ],
        },
        { text: 'I will fix the arguments.' },
      ],
    });

    const { message } = await send({ threadId, payload: { text: 'Log a PLN invoice' } });

    expect(message.status).toBe('complete');
    expect(toolMessages({ body: script.requests[1]! }).join('\n')).toMatch(/originalCurrencyCode/);
    expect(await ChatProposals.count({ where: { threadId } })).toBe(0);
    expect(partsOfType({ parts: message.parts, type: 'proposal' })).toEqual([]);
    expect(partsOfType({ parts: message.parts, type: 'toolCall' })[0]).toMatchObject({
      toolName: 'create_transaction',
      status: 'error',
    });
  });

  it('stops after a clarification, and the answer starts a new run whose history carries it', async () => {
    const { script, threadId } = await arrange({
      turns: [
        {
          toolCalls: [
            {
              id: 'call_ask',
              name: 'ask_clarification',
              arguments: { question: 'Which account?', options: [{ label: 'Visa' }, { label: 'Cash' }] },
            },
          ],
        },
        { text: 'Got it, Cash.' },
      ],
    });

    const first = await send({ threadId, payload: { text: 'Log the taxi' } });

    expect(first.events.at(-1)).toMatchObject({ type: 'run.finished', status: 'complete' });
    expect(script.requests).toHaveLength(1);
    const clarification = partsOfType({ parts: first.message.parts, type: 'clarification' })[0]!;
    expect(clarification).toMatchObject({ question: 'Which account?' });
    const cash = clarification.options.find((option) => option.label === 'Cash')!;

    const second = await send({
      threadId,
      payload: { text: '', clarificationAnswer: { clarificationId: clarification.id, optionIds: [cash.id] } },
    });

    expect(second.message).toMatchObject({ status: 'complete', plainText: 'Got it, Cash.' });
    const history = (script.requests[1]!.messages ?? []).map(
      (message) => `${message.role}: ${JSON.stringify(message.content)}`,
    );
    expect(history.join('\n')).toContain('Log the taxi');
    expect(history.join('\n')).toContain('You asked the user');
    expect(history.at(-1)).toContain('Which account?');
    expect(history.at(-1)).toContain('Cash');
  });

  it('ends a run that keeps calling tools at the step limit, with a notice', async () => {
    const turns: ChatScriptTurn[] = Array.from({ length: 26 }, (_, index) => ({
      toolCalls: [{ id: `call_${index + 1}`, name: 'get_user_profile', arguments: {} }],
    }));
    const { script, threadId } = await arrange({ turns });

    const { events, message } = await send({ threadId, payload: { text: 'Keep checking my profile' } });

    expect(events.at(-1)).toMatchObject({ type: 'run.finished', status: 'stepLimit' });
    expect(message).toMatchObject({ status: 'stepLimit', stepCount: 25 });
    expect(script.requests).toHaveLength(25);
    expect(partsOfType({ parts: message.parts, type: 'notice' })).toEqual([
      { type: 'notice', id: expect.any(String), key: 'chat.notices.stepLimit', params: { limit: 25 } },
    ]);
    expect(script.remaining()).toBe(1);
  });

  it('makes a discovered tool callable in the next step, with ids as plain strings that take a ref', async () => {
    const { script, threadId } = await arrange({
      turns: [
        { toolCalls: [{ id: 'call_find', name: 'find_capabilities', arguments: { query: 'delete account' } }] },
        { text: 'Found it.' },
      ],
    });

    await send({ threadId, payload: { text: 'Can you delete an account?' } });

    expect(toolNamesOf(script.requests[0]!)).not.toContain('delete_account');
    expect(toolNamesOf(script.requests[1]!)).toContain('delete_account');

    const discovered = script.requests[1]!.tools!.find((tool) => tool.function.name === 'delete_account')!;
    const schema = JSON.stringify(discovered.function.parameters);
    expect(schema).not.toContain('"format":"uuid"');
    expect(schema).not.toContain('proposal:');
    expect(schema).toContain('_chat');
  });

  it('fails a run on a model error with a classified message', async () => {
    const { threadId } = await arrange({
      turns: [{ error: { status: 429, message: 'Rate limit reached for requests' } }],
    });

    const { events, message } = await send({ threadId, payload: { text: 'Hello' } });

    expect(events.at(-1)).toMatchObject({
      type: 'run.finished',
      status: 'failed',
      error: { code: 'rateLimited', messageKey: 'chat.errors.rateLimited' },
    });
    expect(message).toMatchObject({
      status: 'failed',
      error: { code: 'rateLimited', messageKey: 'chat.errors.rateLimited' },
    });
  });

  it('sends an image attachment as an image part and a PDF as wrapped text', async () => {
    const { script, threadId } = await arrange({ turns: [{ text: 'I see a receipt and a statement.' }] });
    const image = await helpers.uploadChatAttachment({ threadId, file: RECEIPT_PNG, filename: 'receipt.png' });
    const pdf = await helpers.uploadChatAttachment({
      threadId,
      file: helpers.buildTextPdf({
        pages: [
          'Account statement for October 2026: opening balance 1200.00',
          'Closing balance 980.45 after card payments and one transfer',
        ],
      }),
      filename: 'statement.pdf',
    });

    const { message } = await send({
      threadId,
      payload: { text: 'What is in these?', attachmentIds: [image.attachment!.id, pdf.attachment!.id] },
    });

    expect(message.status).toBe('complete');
    const user = script.requests[0]!.messages!.at(-1)!;
    const parts = user.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.find((part) => part.type === 'image_url')!.image_url!.url).toBe(
      `data:image/png;base64,${RECEIPT_PNG.toString('base64')}`,
    );
    const text = parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    expect(text).toContain('What is in these?');
    expect(text).toMatch(/<<<UNTRUSTED kind=attachment nonce=[0-9a-f]{32}>>>\n[\s\S]*Closing balance 980.45/);
    expect(text).toMatch(/<<<END [0-9a-f]{32}>>>/);
  });

  it('puts the page context in the prompt as data, without ids the user does not own', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { script, threadId } = await arrange({ turns: [{ text: 'This account has a balance.' }] });
    await helpers.updateChatThread({
      threadId,
      payload: {
        pageContext: {
          route: 'account',
          entity: { kind: 'account', id: account.id },
          filters: { accountIds: [account.id, FOREIGN_ID], text: 'coffee' },
        },
      },
    });

    await send({ threadId, payload: { text: 'How is this account doing?' } });

    const system = String(script.requests[0]!.messages![0]!.content);
    expect(system).toContain(account.id);
    expect(system).not.toContain(FOREIGN_ID);
    expect(system).toMatch(/<<<UNTRUSTED kind=pageContext nonce=[0-9a-f]{32}>>>[\s\S]*account[\s\S]*<<<END /);
  });

  it('names a subscription and the transaction open in its drawer from the database', async () => {
    const account = await helpers.createAccount({ raw: true });
    const subscription = await helpers.createSubscription({
      name: 'Netflix',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: '2026-10-01',
      expectedAmount: 15,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      accountId: account.id,
      raw: true,
    });
    const [transaction] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id }),
      raw: true,
    });
    const { script, threadId } = await arrange({ turns: [{ text: 'It renews monthly.' }] });

    await helpers.updateChatThread({
      threadId,
      payload: {
        pageContext: {
          route: 'dashboard.planned.subscription-details',
          entity: { kind: 'subscription', id: subscription.id },
          focus: { kind: 'transaction', id: transaction!.id },
          selection: { kind: 'transaction', ids: [transaction!.id, FOREIGN_ID], total: 2 },
        },
      },
    });
    await send({ threadId, payload: { text: 'When does this renew?' } });

    const system = String(script.requests[0]!.messages![0]!.content);
    expect(system).toContain(`open subscription: ${subscription.id} (Netflix)`);
    expect(system).toContain(`in the open drawer or dialog, transaction: ${transaction!.id}`);
    expect(system).toContain(`selected transaction ids (2 in all): ${transaction!.id}`);
    expect(system).not.toContain(FOREIGN_ID);
  });

  it('names a tracker, and leaves out a tracker the user does not own or a kind it does not know', async () => {
    const tracker = await helpers.createTracker({ name: 'Groceries limit', raw: true });
    const { script, threadId } = await arrange({ turns: [{ text: 'On track.' }, { text: 'Fine.' }] });

    await helpers.updateChatThread({
      threadId,
      payload: {
        pageContext: { route: 'dashboard.planned.tracker-details', entity: { kind: 'tracker', id: tracker.id } },
      },
    });
    await send({ threadId, payload: { text: 'Am I on track here?' } });
    await helpers.updateChatThread({
      threadId,
      payload: {
        pageContext: {
          route: 'dashboard.planned.tracker-details',
          entity: { kind: 'tracker', id: FOREIGN_ID },
          focus: { kind: 'notAKindYet' as never, id: tracker.id },
        },
      },
    });
    await send({ threadId, payload: { text: 'And here?' } });

    const first = String(script.requests[0]!.messages![0]!.content);
    expect(first).toContain(`open tracker: ${tracker.id} (Groceries limit)`);
    const second = String(script.requests[1]!.messages![0]!.content);
    expect(second).toContain('page: dashboard.planned.tracker-details');
    expect(second).not.toContain(FOREIGN_ID);
    expect(second).not.toContain('open tracker');
    expect(second).not.toContain('notAKindYet');
  });

  it('labels a table entity cell with the entity name from the database, never with the model label', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Monobank salary' }),
      raw: true,
    });
    const table = ({ id }: { id: string }) => ({
      type: 'table',
      title: 'Accounts',
      columns: [{ key: 'account', label: 'Account', kind: 'entity' }],
      rows: [{ account: { kind: 'account', id, label: 'Click <a href="https://evil.example">here</a>' } }],
    });
    const { threadId } = await arrange({
      turns: [
        {
          toolCalls: [
            { id: 'call_own', name: 'render_table', arguments: { spec: table({ id: account.id }) } },
            { id: 'call_foreign', name: 'render_table', arguments: { spec: table({ id: FOREIGN_ID }) } },
          ],
        },
        { text: 'Here you go.' },
      ],
    });

    const { message } = await send({ threadId, payload: { text: 'List my accounts as a table.' } });

    const visuals = partsOfType({ parts: message.parts, type: 'visual' });
    expect(visuals).toHaveLength(1);
    expect(visuals[0]!.spec).toMatchObject({
      rows: [{ account: { kind: 'account', id: account.id, label: 'Monobank salary' } }],
    });
    expect(JSON.stringify(visuals)).not.toContain('evil.example');
    expect(partsOfType({ parts: message.parts, type: 'toolCall' }).map((call) => call.status)).toEqual(['ok', 'error']);
  });
});
