import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { proposeCards } from '@tests/helpers/chat-cards';
import { failOnUnscriptedChatRequests } from '@tests/mocks/openai-compatible/chat-script';

useSelfHostWithoutServerAiKeys();
failOnUnscriptedChatRequests();

describe('a run that ends with lookups and nothing to show', () => {
  it('tells the user so instead of leaving a blank reply', async () => {
    const { threadId } = await proposeCards({
      turns: [{ toolCalls: [{ name: 'get_categories', arguments: {} }] }, {}],
      text: 'Log it',
    });

    const loaded = await helpers.getChatThread({ threadId, raw: true });
    const reply = loaded.messages.find((message) => message.role === 'assistant')!;
    expect(reply.parts).toContainEqual(expect.objectContaining({ type: 'notice', key: 'chat.notices.noAnswer' }));
  });
});
