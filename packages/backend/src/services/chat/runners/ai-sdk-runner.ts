import { AI_FEATURE, AI_PROVIDER, CHAT_MAX_STEPS, type ChatToolCallPart } from '@bt/shared/types';
import { aiCallGuards } from '@services/ai/ai-call-guards';
import { AI_MAX_OUTPUT_TOKENS } from '@services/ai/ai-output-limit';
import { trackAiUsage } from '@services/ai/track-ai-usage';
import { hasToolCall, stepCountIs, streamText, type SystemModelMessage } from 'ai';
import { randomUUID } from 'node:crypto';

import { compactArgs, errorMessage } from '../toolkit/result-text';
import { toAiSdkTools } from '../toolkit/to-ai-sdk-tools';
import { prepareChatTurn } from './prepare-turn';
import type { ChatRunner } from './types';

const ABORTED = Symbol('aborted');

/** Resolves when `signal` fires; `release` stops listening. */
const whenAborted = ({
  signal,
}: {
  signal: AbortSignal;
}): { promise: Promise<typeof ABORTED>; release: () => void } => {
  const stop = new AbortController();
  const promise = new Promise<typeof ABORTED>((resolve) => {
    if (signal.aborted) return resolve(ABORTED);

    signal.addEventListener('abort', () => resolve(ABORTED), { once: true, signal: stop.signal });
  });

  return { promise, release: () => stop.abort() };
};

/** An error message short enough for a stored tool-call record. */
const ERROR_SUMMARY_CHARS = 200;

/**
 * The system prompt as a message, so Anthropic can cache it: the tools and the prompt are the stable
 * prefix of every step of every turn. Other providers cache on their own and ignore the option.
 */
const toSystemMessage = ({ content, provider }: { content: string; provider: AI_PROVIDER }): SystemModelMessage => ({
  role: 'system',
  content,
  ...(provider === AI_PROVIDER.anthropic
    ? { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
    : {}),
});

/**
 * Runs one chat turn on an API-key or custom-endpoint model through the AI SDK. The model gets the
 * toolkit (reads run, writes become cards), the full system prompt and the thread's history, and
 * its stream becomes run events: text goes through the text policy, a tool call is a part that
 * opens running and closes with its outcome, and every finished step reports usage and saves the
 * parts so far.
 */
export const runAiSdkChat: ChatRunner = async (input) => {
  const { userId, aiClient, signal, emit, textPolicy, persist } = input;
  const { toolkit, system, messages } = await prepareChatTurn({ input });

  const { abortSignal: callSignal, maxRetries } = aiCallGuards({ provider: aiClient.provider });

  const result = streamText({
    model: aiClient.model,
    system: toSystemMessage({ content: system, provider: aiClient.provider }),
    messages,
    tools: toAiSdkTools({ toolkit }),
    // The core set and the chat's own tools, plus whatever `find_capabilities` found so far.
    prepareStep: () => ({ activeTools: toolkit.activeToolNames() }),
    stopWhen: [stepCountIs(CHAT_MAX_STEPS), hasToolCall('ask_clarification')],
    abortSignal: AbortSignal.any([signal, callSignal]),
    maxRetries,
    maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    // Failures arrive as `error` parts of the stream, where they are rethrown below.
    onError: () => {},
  });

  const textParts = new Map<string, string>();
  /** Tool calls that have started and not ended, by call id. */
  const openCalls = new Map<string, string>();
  const iterator = result.fullStream[Symbol.asyncIterator]();
  const aborted = whenAborted({ signal });
  let stepCount = 0;
  let lastFinishReason: string | undefined;

  const closeCall = async ({ callId, patch }: { callId: string; patch: Partial<ChatToolCallPart> }) => {
    const partId = openCalls.get(callId);
    if (!partId) return;

    openCalls.delete(callId);
    const record = toolkit.toolCallRecords().find((candidate) => candidate.callId === callId);
    await emit({
      type: 'part.updated',
      partId,
      patch: { ...(record?.durationMs === undefined ? {} : { durationMs: record.durationMs }), ...patch },
    });
  };

  try {
    for (;;) {
      // The race makes a cancel immediate whether or not the provider's stream notices the abort.
      const next = await Promise.race([iterator.next(), aborted.promise]);
      if (next === ABORTED) return { status: 'aborted', stepCount };
      if (next.done) break;

      const part = next.value;
      switch (part.type) {
        case 'text-start':
          textParts.set(part.id, randomUUID());
          break;

        case 'text-delta': {
          const partId = textParts.get(part.id) ?? randomUUID();
          textParts.set(part.id, partId);
          await textPolicy.delta({ partId, delta: part.text });
          break;
        }

        case 'tool-call': {
          const partId = randomUUID();
          openCalls.set(part.toolCallId, partId);
          await emit({
            type: 'part.started',
            part: {
              type: 'toolCall',
              id: partId,
              callId: part.toolCallId,
              toolName: part.toolName,
              args: compactArgs({ args: part.input }),
              status: 'running',
            },
          });
          break;
        }

        case 'tool-result': {
          const record = toolkit.toolCallRecords().find((candidate) => candidate.callId === part.toolCallId);
          await closeCall({
            callId: part.toolCallId,
            patch: {
              status: 'ok',
              ...(record?.resultSummary === undefined ? {} : { resultSummary: record.resultSummary }),
            },
          });
          break;
        }

        case 'tool-error': {
          // A failed validation never reaches the toolkit, so its message comes from the error itself.
          const record = toolkit.toolCallRecords().find((candidate) => candidate.callId === part.toolCallId);
          await closeCall({
            callId: part.toolCallId,
            patch: {
              status: 'error',
              error: record?.error ?? errorMessage({ error: part.error }).slice(0, ERROR_SUMMARY_CHARS),
            },
          });
          break;
        }

        case 'finish-step':
          stepCount++;
          lastFinishReason = part.finishReason;
          textParts.clear();
          await emit({
            type: 'usage',
            inputTokens: part.usage.inputTokens ?? 0,
            outputTokens: part.usage.outputTokens ?? 0,
            cachedInputTokens: part.usage.inputTokenDetails.cacheReadTokens ?? part.usage.cachedInputTokens ?? 0,
          });
          trackAiUsage({ userId, feature: AI_FEATURE.chat, aiClient, usage: part.usage });
          await persist({ stepCount });
          break;

        case 'error':
          throw part.error;

        case 'abort':
          return { status: 'aborted', stepCount };

        default:
          break;
      }
    }
  } finally {
    aborted.release();
    void iterator.return?.();

    // A call the run left open (cancelled, failed, interrupted) must not stay "running" in the stored message.
    await Promise.allSettled(
      [...openCalls.keys()].map((callId) => closeCall({ callId, patch: { status: 'error', error: 'not finished' } })),
    );
  }

  // The model wanted another step after the last one the run allows; a clarification stops the run on purpose.
  if (lastFinishReason === 'tool-calls' && stepCount >= CHAT_MAX_STEPS && !toolkit.isAwaitingClarification()) {
    await emit({
      type: 'part.started',
      part: { type: 'notice', id: randomUUID(), key: 'chat.notices.stepLimit', params: { limit: CHAT_MAX_STEPS } },
    });
    return { status: 'stepLimit', stepCount };
  }

  return { status: 'complete', stepCount };
};
