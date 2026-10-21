import { describe, expect, it } from '@jest/globals';
import ChatThreads from '@models/chat-threads.model';
import { PNG_1X1_BASE64 } from '@tests/fixtures/statement-parser-fixtures';
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

async function arrange({ turns }: { turns: ChatScriptTurn[] }) {
  await helpers.createFirstConnection();
  const script = createChatScript({ turns });
  global.mswMockServer.use(script.handler);
  return { script, threadId: (await helpers.createChatThread({ raw: true })).id };
}

async function send({ threadId, text, attachmentIds }: { threadId: string; text: string; attachmentIds?: string[] }) {
  const sent = await helpers.sendChatMessage({
    threadId,
    payload: { text, ...(attachmentIds ? { attachmentIds } : {}) },
    raw: true,
  });
  await helpers.getChatRunEvents({ runId: sent.runId });
}

const titleCall = ({ title }: { title: string }): ChatScriptTurn => ({
  toolCalls: [{ id: 'call_title', name: 'set_thread_title', arguments: { title } }],
});

const systemPromptOf = (body: ChatCompletionRequestBody) =>
  String((body.messages ?? []).find((message) => message.role === 'system')?.content ?? '');

const storedTitle = async ({ threadId }: { threadId: string }) => {
  const thread = (await ChatThreads.findByPk(threadId))!;
  return { title: thread.title, titleSource: thread.titleSource };
};

describe('The assistant names the conversation', () => {
  it('asks in the first turn, takes the title it gives and stops asking', async () => {
    const { script, threadId } = await arrange({
      turns: [
        titleCall({ title: 'Coffee spending in September' }),
        { text: 'Here is the breakdown.' },
        { text: 'Sure.' },
      ],
    });

    await send({ threadId, text: 'Where did my money go on coffee last month?' });
    expect(await storedTitle({ threadId })).toEqual({ title: 'Coffee spending in September', titleSource: 'model' });
    expect(systemPromptOf(script.requests[0]!)).toContain('set_thread_title');

    await send({ threadId, text: 'And in October?' });
    expect(systemPromptOf(script.requests[2]!)).not.toContain('set_thread_title');
  });

  it('shows the first words as the title until the assistant has named it', async () => {
    const { threadId } = await arrange({ turns: [{ text: 'Hello.' }] });

    await send({ threadId, text: 'Where did my money go?' });

    expect(await storedTitle({ threadId })).toEqual({ title: 'Where did my money go?', titleSource: 'auto' });
  });

  it('treats the title as text: markup and control characters go, the length is capped', async () => {
    const { threadId } = await arrange({
      turns: [titleCall({ title: '# **Budget** `check`\u0000 <b>now</b>' }), { text: 'Done.' }],
    });

    await send({ threadId, text: 'Check my budget' });

    expect((await storedTitle({ threadId })).title).toBe('Budget check bnow/b');
  });

  it('keeps the first words when the title it gives names nothing, and lets it try again next turn', async () => {
    const { script, threadId } = await arrange({
      turns: [titleCall({ title: '***' }), { text: 'Done.' }, titleCall({ title: 'Budget check' }), { text: 'Done.' }],
    });

    await send({ threadId, text: 'Check my budget' });
    expect(await storedTitle({ threadId })).toEqual({ title: 'Check my budget', titleSource: 'auto' });

    await send({ threadId, text: 'Again' });
    expect(systemPromptOf(script.requests[2]!)).toContain('set_thread_title');
    expect(await storedTitle({ threadId })).toEqual({ title: 'Budget check', titleSource: 'model' });
  });

  it('never replaces a title the user typed', async () => {
    const { threadId } = await arrange({ turns: [titleCall({ title: 'Model name' }), { text: 'Done.' }] });
    await helpers.updateChatThread({ threadId, payload: { title: 'My own name' } });

    await send({ threadId, text: 'Check my budget' });

    expect(await storedTitle({ threadId })).toEqual({ title: 'My own name', titleSource: 'user' });
  });

  it('names a thread whose first message is only an image, which shows no title until then', async () => {
    const { threadId } = await arrange({
      turns: [titleCall({ title: 'Receipt from Nord Coffee' }), { text: 'A receipt.' }],
    });
    const upload = await helpers.uploadChatAttachment({
      threadId,
      file: Buffer.from(PNG_1X1_BASE64, 'base64'),
      filename: 'image.png',
    });

    await send({ threadId, text: '', attachmentIds: [upload.attachment!.id] });

    expect(await storedTitle({ threadId })).toEqual({ title: 'Receipt from Nord Coffee', titleSource: 'model' });
  });
});
