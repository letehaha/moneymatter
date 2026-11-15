import type { ChatMessage, ChatMessagePart } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import {
  type ChatCompletionRequestBody,
  type ChatScriptTurn,
  createChatScript,
  failOnUnscriptedChatRequests,
} from '@tests/mocks/openai-compatible/chat-script';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

const TEST_TIMEOUT_MS = 90_000;

/** Spend by month over the seeded transactions: 2026-08 10, 2026-09 50.5, 2026-10 5. */
const MONTHLY_CODE = `
const months = byMonth(input.tx.transactions, 'time', 'amount').map((m) => ({ month: m.month, sum: m.sum }));
return {
  values: { total: minor.sum(input.tx.transactions, 2, 'amount'), months },
  charts: {
    monthly: {
      type: 'chart',
      kind: 'bar',
      title: 'Spend by month',
      unit: { kind: 'money', currencyCode: 'USD' },
      xAxis: { type: 'category', values: months.map((m) => m.month) },
      series: [{ name: 'Spend', values: months.map((m) => m.sum) }],
    },
  },
};`;

const TX_INPUT = {
  name: 'tx',
  tool: 'search_transactions',
  args: { startDate: '2026-08-01T00:00:00.000Z', endDate: '2026-11-30T00:00:00.000Z' },
  allPages: true,
};

const MONTHLY_CHART = {
  type: 'chart',
  kind: 'bar',
  title: 'Spend by month',
  unit: { kind: 'money', currencyCode: 'USD' },
  xAxis: { type: 'category', values: ['2026-08', '2026-09', '2026-10'] },
  series: [{ name: 'Spend', values: [10, 50.5, 5] }],
};

const TIMEOUT_CODE = 'while (true) {}';

const partsOfType = <T extends ChatMessagePart['type']>({
  parts,
  type,
}: {
  parts: ChatMessagePart[];
  type: T;
}): Array<Extract<ChatMessagePart, { type: T }>> =>
  parts.filter((part): part is Extract<ChatMessagePart, { type: T }> => part.type === type);

async function seedTransactions() {
  const account = await helpers.createAccount({ raw: true });

  for (const [time, amount] of [
    ['2026-08-10T00:00:00.000Z', 10],
    ['2026-09-05T00:00:00.000Z', 20.5],
    ['2026-09-20T00:00:00.000Z', 30],
    ['2026-10-02T00:00:00.000Z', 5],
  ] as const) {
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount, time }),
      raw: true,
    });
  }
}

/** The tool results the model received in one request, in order. */
const toolMessages = ({ body }: { body: ChatCompletionRequestBody }): string[] =>
  (body.messages ?? []).filter((message) => message.role === 'tool').map((message) => String(message.content));

const analysisIdIn = ({ body }: { body: ChatCompletionRequestBody }) => {
  const match = /"analysisId":"([0-9a-f-]{36})"/.exec(toolMessages({ body }).join('\n'));
  expect(match).not.toBeNull();
  return match![1]!;
};

async function send({
  threadId,
  text,
}: {
  threadId: string;
  text: string;
}): Promise<{ events: Awaited<ReturnType<typeof helpers.getChatRunEvents>>['events']; message: ChatMessage }> {
  const sent = await helpers.sendChatMessage({ threadId, payload: { text }, raw: true });
  const stream = await helpers.getChatRunEvents({ runId: sent.runId });
  const loaded = await helpers.getChatThread({ threadId, raw: true });

  return { events: stream.events, message: loaded.messages.find((message) => message.id === sent.messageId)! };
}

async function arrangeScripted({ turns }: { turns: ChatScriptTurn[] }) {
  await helpers.createFirstConnection();
  const script = createChatScript({ turns });
  global.mswMockServer.use(script.handler);

  return { script, threadId: (await helpers.createChatThread({ raw: true })).id };
}

describe('run_analysis on the AI SDK path', () => {
  it(
    'answers from an analysis over search_transactions pages and draws its chart without the data being copied',
    async () => {
      await seedTransactions();
      const { script, threadId } = await arrangeScripted({
        turns: [
          {
            toolCalls: [
              {
                id: 'call_analysis',
                name: 'run_analysis',
                arguments: { code: MONTHLY_CODE, inputs: [TX_INPUT] },
              },
            ],
          },
          (body) => ({
            toolCalls: [
              {
                id: 'call_chart',
                name: 'render_chart',
                arguments: { source: { analysisId: analysisIdIn({ body }), key: 'monthly' } },
              },
            ],
          }),
          { text: 'September was the biggest month.' },
        ],
      });

      const { events, message } = await send({ threadId, text: 'How did my spending change by month?' });

      expect(events.at(-1)).toMatchObject({ type: 'run.finished', status: 'complete' });
      expect(script.requests[0]!.tools!.map((tool) => tool.function.name)).toContain('run_analysis');

      const [analysis] = partsOfType({ parts: message.parts, type: 'analysis' });
      expect(analysis).toMatchObject({
        status: 'ok',
        code: MONTHLY_CODE,
        inputs: [{ name: 'tx', source: { tool: 'search_transactions', allPages: true } }],
        output: {
          values: {
            total: 65.5,
            months: [
              { month: '2026-08', sum: 10 },
              { month: '2026-09', sum: 50.5 },
              { month: '2026-10', sum: 5 },
            ],
          },
          charts: { monthly: MONTHLY_CHART },
        },
        durationMs: expect.any(Number),
      });

      // The model read the numbers (as data) and named the analysis; the chart carries no copy of them.
      const answer = toolMessages({ body: script.requests[1]! })[0]!;
      expect(answer).toMatch(/^<<<UNTRUSTED kind=toolResult nonce=[0-9a-f]{32}>>>/);
      expect(answer).toContain('"total":65.5');
      expect(answer).toContain(analysis!.id);

      expect(partsOfType({ parts: message.parts, type: 'visual' })).toEqual([
        { type: 'visual', id: expect.any(String), spec: MONTHLY_CHART },
      ]);
      const calls = partsOfType({ parts: message.parts, type: 'toolCall' });
      expect(calls.map((call) => [call.toolName, call.status])).toEqual([
        ['run_analysis', 'ok'],
        ['render_chart', 'ok'],
      ]);
      expect(calls[1]!.args).toEqual({ source: { analysisId: analysis!.id, key: 'monthly' } });
      expect(message.plainText).toBe('September was the biggest month.');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'reaches the model as a tool error when the code times out, and the run still completes',
    async () => {
      const { script, threadId } = await arrangeScripted({
        turns: [
          { toolCalls: [{ id: 'call_loop', name: 'run_analysis', arguments: { code: TIMEOUT_CODE } }] },
          { text: 'The calculation took too long, so I cannot give you that figure.' },
        ],
      });

      const { events, message } = await send({ threadId, text: 'Compute something heavy' });

      expect(events.at(-1)).toMatchObject({ type: 'run.finished', status: 'complete' });
      expect(message.status).toBe('complete');

      const [analysis] = partsOfType({ parts: message.parts, type: 'analysis' });
      expect(analysis).toMatchObject({ status: 'error', error: expect.stringContaining('timeout') });
      expect(analysis!.output).toBeUndefined();

      const [call] = partsOfType({ parts: message.parts, type: 'toolCall' });
      expect(call).toMatchObject({ toolName: 'run_analysis', status: 'error' });
      expect(toolMessages({ body: script.requests[1]! })[0]).toContain('timeout');
      expect(message.plainText).toContain('took too long');
    },
    TEST_TIMEOUT_MS,
  );
});
