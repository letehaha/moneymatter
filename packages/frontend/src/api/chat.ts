import { api } from '@/api/_api';
import { fetchBinaryDownload } from '@/api/_binary-download';
import { API_HTTP, API_VER } from '@/api/api-base-url';
import { getCurrentLocale } from '@/i18n';
import {
  ATTACHMENT_FILENAME_HEADER,
  CHAT_DOCUMENT_PASSWORD_HEADER,
  type ChatAppliedPage,
  type ChatApproveAllRequest,
  type ChatApproveAllResponse,
  type ChatApproveRequest,
  type ChatAttachment,
  type ChatCancelRunResponse,
  type ChatCardActionResponse,
  type ChatCreateThreadRequest,
  type ChatDefaultConnection,
  type ChatEditProposalRequest,
  type ChatProposalCard,
  type ChatRetentionDays,
  type ChatRunEvent,
  type ChatSendMessageRequest,
  type ChatSendMessageResponse,
  type ChatSettings,
  type ChatThread,
  type ChatThreadListPage,
  type ChatThreadWithMessages,
  type ChatUpdateThreadRequest,
} from '@bt/shared/types';
import { fetchEventSource } from '@microsoft/fetch-event-source';

export const listChatThreads = ({
  q,
  cursor,
  limit,
}: {
  q?: string;
  cursor?: string;
  limit?: number;
} = {}): Promise<ChatThreadListPage> => api.get('/chat/threads', { q, cursor, limit });

export const createChatThread = ({
  title,
  connectionId,
  modelId,
  pageContext,
}: ChatCreateThreadRequest = {}): Promise<ChatThread> =>
  api.post('/chat/threads', {
    ...(title === undefined ? {} : { title }),
    ...(connectionId === undefined ? {} : { connectionId }),
    ...(modelId === undefined ? {} : { modelId }),
    ...(pageContext === undefined ? {} : { pageContext }),
  });

/** The connection a new conversation starts on when the user picks none. */
export const getChatDefaultConnection = (): Promise<ChatDefaultConnection> => api.get('/chat/default-connection');

/** The latest page of a thread, or the page just before the message `before`. */
export const getChatThread = ({
  threadId,
  before,
  limit,
}: {
  threadId: string;
  before?: string;
  limit?: number;
}): Promise<ChatThreadWithMessages> => api.get(`/chat/threads/${threadId}`, { before, limit });

export const updateChatThread = ({
  threadId,
  payload,
}: {
  threadId: string;
  payload: ChatUpdateThreadRequest;
}): Promise<ChatThread> => api.patch(`/chat/threads/${threadId}`, payload);

export const deleteChatThread = async ({ threadId }: { threadId: string }): Promise<void> => {
  await api.delete(`/chat/threads/${threadId}`);
};

export const updateChatSettings = ({
  retentionDays,
}: {
  retentionDays: ChatRetentionDays | null;
}): Promise<ChatSettings> => api.put('/chat/settings', { retentionDays });

export const uploadChatAttachment = ({
  threadId,
  file,
  password,
}: {
  threadId: string;
  file: File;
  password?: string;
}): Promise<ChatAttachment> =>
  api.postRaw({
    endpoint: `/chat/threads/${threadId}/attachments`,
    body: file,
    headers: {
      'Content-Type': 'application/octet-stream',
      [ATTACHMENT_FILENAME_HEADER]: encodeURIComponent(file.name),
      ...(password ? { [CHAT_DOCUMENT_PASSWORD_HEADER]: password } : {}),
    },
  });

export const sendChatMessage = ({
  threadId,
  payload,
}: {
  threadId: string;
  payload: ChatSendMessageRequest;
}): Promise<ChatSendMessageResponse> => api.post(`/chat/threads/${threadId}/messages`, { ...payload });

export const cancelChatRun = ({ runId }: { runId: string }): Promise<ChatCancelRunResponse> =>
  api.post(`/chat/runs/${runId}/cancel`);

export const editChatProposal = ({
  proposalId,
  payload,
}: {
  proposalId: string;
  payload: ChatEditProposalRequest;
}): Promise<ChatProposalCard> => api.patch(`/chat/proposals/${proposalId}`, { ...payload });

export const refreshChatProposal = ({ proposalId }: { proposalId: string }): Promise<ChatProposalCard> =>
  api.post(`/chat/proposals/${proposalId}/refresh`);

export const approveChatProposal = ({
  proposalId,
  payload,
}: {
  proposalId: string;
  payload: ChatApproveRequest;
}): Promise<ChatCardActionResponse> => api.post(`/chat/proposals/${proposalId}/approve`, { ...payload });

export const rejectChatProposal = ({ proposalId }: { proposalId: string }): Promise<ChatCardActionResponse> =>
  api.post(`/chat/proposals/${proposalId}/reject`);

/** A comment starts a run, like a message does: attach to the returned `runId`. */
export const commentOnChatProposal = ({
  proposalId,
  text,
}: {
  proposalId: string;
  text: string;
}): Promise<ChatSendMessageResponse> => api.post(`/chat/proposals/${proposalId}/comment`, { text });

export const approveAllChatMessage = ({
  messageId,
  payload,
}: {
  messageId: string;
  payload: ChatApproveAllRequest;
}): Promise<ChatApproveAllResponse> => api.post(`/chat/messages/${messageId}/approve-all`, { ...payload });

export const listChatAppliedCards = ({
  cursor,
  limit,
}: {
  cursor?: string;
  limit?: number;
} = {}): Promise<ChatAppliedPage> => api.get('/chat/applied', { cursor, limit });

// ---------------------------------------------------------------------------------------------
// Run stream
// ---------------------------------------------------------------------------------------------

const SESSION_ID_KEY = 'session-id';
const RUN_FINISHED: ChatRunEvent['type'] = 'run.finished';
const STREAM_RETRY_DELAY_MS = 1000;
const STREAM_MAX_RETRY_DELAY_MS = 8000;
const STREAM_MAX_CONSECUTIVE_FAILURES = 6;

/** How `streamChatRunEvents` ended. `failed` means the stream cannot be followed; the thread holds the truth. */
type ChatRunStreamOutcome = 'finished' | 'aborted' | 'failed';

const waitFor = ({ ms, signal }: { ms: number; signal: AbortSignal }) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });

/**
 * Follows one run's events and hands each to `onEvent` in order. The stream replays a live run from
 * its start and resumes after the last id seen when the connection drops (`Last-Event-ID`), so a
 * reload and a flaky network both end with the full event list. Resolves when the run finished,
 * when `signal` aborted, or when the stream cannot be followed any more (`failed`).
 *
 * The retry loop is ours rather than the library's: the library keeps the id inside one call, and an
 * explicit loop makes the resume point something we can hand to the next call and test.
 */
export async function streamChatRunEvents({
  runId,
  signal,
  onEvent,
  retryDelayMs = STREAM_RETRY_DELAY_MS,
  maxConsecutiveFailures = STREAM_MAX_CONSECUTIVE_FAILURES,
}: {
  runId: string;
  signal: AbortSignal;
  onEvent: (event: ChatRunEvent) => void;
  retryDelayMs?: number;
  maxConsecutiveFailures?: number;
}): Promise<ChatRunStreamOutcome> {
  const url = `${API_HTTP}${API_VER}/chat/runs/${runId}/events`;
  let lastEventId: string | undefined;
  let consecutiveFailures = 0;

  while (!signal.aborted) {
    const attempt = new AbortController();
    const abortAttempt = () => attempt.abort();
    signal.addEventListener('abort', abortAttempt);
    let finished = false;
    let refused = false;

    try {
      await fetchEventSource(url, {
        method: 'GET',
        credentials: 'include',
        signal: attempt.signal,
        // A run keeps going while the tab is hidden; closing the stream would only force a replay.
        openWhenHidden: true,
        headers: {
          'X-Session-ID': window.sessionStorage?.getItem(SESSION_ID_KEY) || '',
          'Accept-Language': getCurrentLocale(),
          ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
        },
        onopen: async (response) => {
          if (!response.ok) {
            refused = true;
            throw new Error(`Run stream refused: ${response.status}`);
          }
        },
        onmessage: (message) => {
          // Comments (the greeting and the heartbeat) arrive as events without a name or data.
          if (!message.event || !message.data) return;
          if (message.id) lastEventId = message.id;

          let event: ChatRunEvent;
          try {
            event = { type: message.event, ...JSON.parse(message.data) } as ChatRunEvent;
          } catch {
            return;
          }
          // An event is progress; a connection that opens and drops with nothing to show is not.
          consecutiveFailures = 0;
          onEvent(event);
          if (event.type === RUN_FINISHED) {
            finished = true;
            attempt.abort();
          }
        },
        // The server closing the stream before `run.finished` is a drop, not an end.
        onclose: () => {
          throw new Error('Run stream closed before the run finished');
        },
        onerror: (error) => {
          throw error;
        },
      });
    } catch {
      // Handled below, from the flags: a refusal, a finished run and an abort need no retry.
    } finally {
      signal.removeEventListener('abort', abortAttempt);
    }

    if (finished) return 'finished';
    if (refused) return 'failed';
    if (signal.aborted) break;

    consecutiveFailures += 1;
    if (consecutiveFailures > maxConsecutiveFailures) return 'failed';
    await waitFor({ ms: Math.min(retryDelayMs * 2 ** (consecutiveFailures - 1), STREAM_MAX_RETRY_DELAY_MS), signal });
  }

  return 'aborted';
}

/** The bytes of an image attached to a message, with the type the server read from them. */
export const loadChatAttachmentImage = async ({ attachmentId }: { attachmentId: string }): Promise<Blob> => {
  const { blob } = await fetchBinaryDownload({
    path: `/chat/attachments/${attachmentId}/image`,
    method: 'GET',
    accept: 'image/*, application/json',
    feature: 'chat-attachment-image',
  });

  return blob;
};
