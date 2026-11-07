import { afterEach } from '@jest/globals';
import { HttpResponse, http } from 'msw';

import { CUSTOM_ENDPOINT_BASE_URL } from './mock-api';

/**
 * A scripted model for the chat e2e suites. It stands in for a custom OpenAI-compatible endpoint
 * and answers each `/chat/completions` request with the next scripted turn, streamed the way the
 * real API streams it (SSE `chat.completion.chunk`s). Every request body is recorded, and a request
 * with no turn left is answered with a 500 and counted, so a run that asks the model more often
 * than the test expects fails the test instead of looping on a default answer.
 */

export interface ScriptedToolCall {
  /** Defaults to `call_<n>`. */
  id?: string;
  name: string;
  /** An object is serialized to JSON; a string is sent as written (for malformed-argument cases). */
  arguments: unknown;
}

export interface ScriptedChatTurn {
  /** Text pieces streamed as separate deltas; a string is one piece. */
  text?: string | string[];
  toolCalls?: ScriptedToolCall[];
  usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number };
  /** Wait before the first chunk. */
  startDelayMs?: number;
  /** Wait before every text piece after the first; a cancelled request stops the wait. */
  pieceDelayMs?: number;
  /** Answer the request with an HTTP error instead of a stream. */
  error?: { status: number; message: string; code?: string };
  finishReason?: 'stop' | 'length' | 'tool_calls';
}

export interface ChatCompletionRequestBody {
  model?: string;
  stream?: boolean;
  messages?: Array<{ role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }>;
  tools?: Array<{ type: string; function: { name: string; description?: string; parameters?: unknown } }>;
  [key: string]: unknown;
}

export type ChatScriptTurn = ScriptedChatTurn | ((body: ChatCompletionRequestBody) => ScriptedChatTurn);

export interface ChatScript {
  /** Register it with `global.mswMockServer.use(script.handler)`. */
  handler: ReturnType<typeof http.post>;
  /** Every request body the model received, in order. */
  requests: ChatCompletionRequestBody[];
  /** Requests that arrived with no turn left. */
  unscripted: ChatCompletionRequestBody[];
  /** Turns not yet consumed. */
  remaining: () => number;
}

const MODEL_NAME = 'scripted-model';
const CREATED = 1_700_000_000;

const created: ChatScript[] = [];

/**
 * Call once in a `describe` body: after every test it fails when a script from that test was asked
 * for a turn it did not have.
 */
export function failOnUnscriptedChatRequests(): void {
  afterEach(() => {
    const offenders = created.splice(0).filter((script) => script.unscripted.length > 0);
    if (offenders.length > 0) {
      const count = offenders.reduce((sum, script) => sum + script.unscripted.length, 0);
      throw new Error(`The scripted chat model received ${count} request(s) with no turn left`);
    }
  });
}

const sleep = ({ ms, signal }: { ms: number; signal: AbortSignal }): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

const chunk = ({ delta, finishReason = null }: { delta: Record<string, unknown>; finishReason?: string | null }) => ({
  id: 'chatcmpl-chat-script',
  object: 'chat.completion.chunk',
  created: CREATED,
  model: MODEL_NAME,
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

function turnToStream({ turn, signal }: { turn: ScriptedChatTurn; signal: AbortSignal }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const pieces = turn.text === undefined ? [] : Array.isArray(turn.text) ? turn.text : [turn.text];
  const toolCalls = turn.toolCalls ?? [];
  const finishReason = turn.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop');

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`),
        );

      try {
        if (turn.startDelayMs) await sleep({ ms: turn.startDelayMs, signal });
        if (signal.aborted) return controller.close();

        send(chunk({ delta: { role: 'assistant', content: '' } }));

        for (const [index, piece] of pieces.entries()) {
          if (index > 0 && turn.pieceDelayMs) await sleep({ ms: turn.pieceDelayMs, signal });
          if (signal.aborted) return controller.close();
          send(chunk({ delta: { content: piece } }));
        }

        if (toolCalls.length > 0) {
          send(
            chunk({
              delta: {
                tool_calls: toolCalls.map((call, index) => ({
                  index,
                  id: call.id ?? `call_${index + 1}`,
                  type: 'function',
                  function: {
                    name: call.name,
                    arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments),
                  },
                })),
              },
            }),
          );
        }

        send(chunk({ delta: {}, finishReason }));

        if (turn.usage) {
          send({
            ...chunk({ delta: {} }),
            choices: [],
            usage: {
              prompt_tokens: turn.usage.promptTokens,
              completion_tokens: turn.usage.completionTokens,
              total_tokens: turn.usage.promptTokens + turn.usage.completionTokens,
              prompt_tokens_details: { cached_tokens: turn.usage.cachedTokens ?? 0 },
            },
          });
        }

        send('[DONE]');
        controller.close();
      } catch {
        // The client went away; there is nobody left to stream to.
      }
    },
  });
}

/** Builds a script for the custom endpoint at `baseUrl`; turns are consumed in order, one per request. */
export function createChatScript({
  turns,
  baseUrl = CUSTOM_ENDPOINT_BASE_URL,
}: {
  turns: ChatScriptTurn[];
  baseUrl?: string;
}): ChatScript {
  const queue = [...turns];
  const requests: ChatCompletionRequestBody[] = [];
  const unscripted: ChatCompletionRequestBody[] = [];

  const handler = http.post(`${baseUrl}/chat/completions`, async ({ request }) => {
    const body = (await request.clone().json()) as ChatCompletionRequestBody;
    requests.push(body);

    const next = queue.shift();
    if (!next) {
      unscripted.push(body);
      return HttpResponse.json(
        { error: { message: 'No scripted turn left', type: 'script_exhausted' } },
        { status: 500 },
      );
    }

    const turn = typeof next === 'function' ? next(body) : next;

    if (turn.error) {
      return HttpResponse.json(
        { error: { message: turn.error.message, type: 'invalid_request_error', code: turn.error.code ?? null } },
        { status: turn.error.status },
      );
    }

    return new HttpResponse(turnToStream({ turn, signal: request.signal }), {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
  });

  const script: ChatScript = { handler, requests, unscripted, remaining: () => queue.length };
  created.push(script);
  return script;
}
