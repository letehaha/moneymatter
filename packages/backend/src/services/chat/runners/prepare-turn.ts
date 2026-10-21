import { getModelNameFromModelId } from '@bt/shared/types';
import ChatAttachments from '@models/chat-attachments.model';
import ChatThreads from '@models/chat-threads.model';
import Users from '@models/users.model';
import { getModelProfile } from '@services/ai/model-catalog';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { getUserBaseCurrency } from '@services/user.service';
import type { ModelMessage } from 'ai';

import { historyBudgetTokens, loadHistoryMessages } from '../prompt/history';
import { renderPageContext, sanitizePageContext } from '../prompt/page-context';
import { buildSystemPrompt } from '../prompt/system-prompt';
import { createUntrustedWrapper } from '../prompt/untrusted';
import { buildChatToolkit } from '../toolkit/build-toolkit';
import type { ChatToolkit } from '../toolkit/types';
import type { ChatRunnerInput } from './types';

/**
 * Everything a chat turn needs before a model is called: the run's toolkit, the system prompt and the
 * thread's history (the new message last).
 */
export async function prepareChatTurn({
  input,
}: {
  input: ChatRunnerInput;
}): Promise<{ toolkit: ChatToolkit; system: string; messages: ModelMessage[] }> {
  const { runId, userId, threadId, messageId, userMessageId, aiClient, emit, textPolicy } = input;

  const [user, attachments, settings, baseCurrency, profile, thread] = await Promise.all([
    Users.findByPk(userId, { attributes: ['id', 'username', 'authUserId', 'role'], rejectOnEmpty: true }),
    ChatAttachments.findAll({ where: { messageId: userMessageId, userId }, attributes: ['id', 'fileName'] }),
    getUserSettings({ userId }),
    getUserBaseCurrency({ userId }),
    getModelProfile({
      provider: aiClient.provider,
      model: getModelNameFromModelId({ modelId: aiClient.modelId }),
    }),
    ChatThreads.findOne({ where: { id: threadId, userId }, attributes: ['titleSource', 'pageContext'] }),
  ]);

  const untrusted = createUntrustedWrapper();
  const pageContext = await sanitizePageContext({ userId, context: thread?.pageContext ?? null });
  const toolkit = buildChatToolkit({
    run: {
      user,
      threadId,
      messageId,
      runId,
      pageContext,
      attachments: attachments.map(({ id, fileName }) => ({ id, fileName })),
      emit,
      textPolicy,
      wrapUntrusted: untrusted.wrap,
    },
  });

  const system = buildSystemPrompt({
    now: new Date(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: settings.locale,
    baseCurrency: baseCurrency?.currencyCode ?? null,
    pageContext: pageContext ? renderPageContext({ context: pageContext, wrap: untrusted.wrap }) : null,
    nameThread: thread?.titleSource === 'auto',
  });
  const messages = await loadHistoryMessages({
    threadId,
    userId,
    currentUserMessageId: userMessageId,
    excludeMessageId: messageId,
    budgetTokens: historyBudgetTokens({ contextWindow: profile.contextWindow }),
    wrap: untrusted.wrap,
  });

  return { toolkit, system, messages };
}
