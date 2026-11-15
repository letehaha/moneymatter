import { type ChatRunEvent, type RecordId, USER_ROLES } from '@bt/shared/types';
import { jest } from '@jest/globals';
import { createTextPolicy } from '@services/chat/prompt/text-policy';
import type { ChatToolkitRun } from '@services/chat/toolkit/types';
import { getToolCatalog, type ToolCallResult, type ToolCatalogEntry } from '@services/mcp/tool-catalog';

export const CHAT_TEST_THREAD_ID = '1b4e28ba-2fa1-4d2b-8a5c-3c6f0a9d7e10';
export const CHAT_TEST_MESSAGE_ID = '7c9e6679-7425-4a40-b5a1-9f3d6c2e8b14';
export const CHAT_TEST_RUN_ID = 'e2d4a6c8-1f3b-4a5d-9e7f-0b8c6d4a2e13';
export const CHAT_TEST_USER_ID = 42;

/** A toolkit run whose events are collected, with a real text policy on the same stream. */
export function makeChatRun(overrides: Partial<ChatToolkitRun> = {}): { run: ChatToolkitRun; events: ChatRunEvent[] } {
  const events: ChatRunEvent[] = [];
  const emit = (event: ChatRunEvent) => {
    events.push(event);
  };

  return {
    events,
    run: {
      user: { id: CHAT_TEST_USER_ID, username: 'jane', authUserId: 'auth-42' as RecordId, role: USER_ROLES.common },
      threadId: CHAT_TEST_THREAD_ID,
      messageId: CHAT_TEST_MESSAGE_ID,
      runId: CHAT_TEST_RUN_ID,
      pageContext: null,
      attachments: [],
      emit,
      textPolicy: createTextPolicy({ emit }),
      ...overrides,
    },
  };
}

const textResult = ({ data }: { data: unknown }): ToolCallResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

/**
 * The real catalog with every `invoke` replaced by a spy, so a test can see whether a handler ran.
 * A tool answers with `implementations[name](args)` as JSON, or `{}`. The schemas, validators and
 * names stay the real ones.
 */
export function stubCatalog({
  implementations = {},
}: { implementations?: Record<string, (args: unknown) => unknown> } = {}): ToolCatalogEntry[] {
  return getToolCatalog().map((entry) => ({
    ...entry,
    invoke: jest.fn<ToolCatalogEntry['invoke']>(async ({ args }) =>
      textResult({ data: implementations[entry.name]?.(args) ?? {} }),
    ),
  }));
}
