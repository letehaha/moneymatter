import {
  CHAT_ATTACHMENT_EXCERPT_CHARS,
  CHAT_READ_RESULT_MAX_CHARS,
  type ChatAttachmentKind,
  type ChatClarificationPart,
  type ChatMessagePart,
  type ChatMessageRole,
  type ChatMessageStatus,
  type ChatProposalStatus,
  type ChatToolCallPart,
  type ChatVisualSpec,
} from '@bt/shared/types';
import ChatAttachments from '@models/chat-attachments.model';
import ChatMessages from '@models/chat-messages.model';
import ChatProposals from '@models/chat-proposals.model';
import { estimateTokenCount } from '@services/import-export/statement-parser/text-extractor';
import type { ImagePart, ModelMessage, TextPart } from 'ai';
import { col, fn, Op } from 'sequelize';

import type { UntrustedWrapper } from './untrusted';

/** Share of the model's context window the history may fill, and its ceiling. */
const HISTORY_CONTEXT_SHARE = 0.6;
const HISTORY_MAX_TOKENS = 120_000;
/** Used when the model catalog does not know the model's window. */
const UNKNOWN_CONTEXT_WINDOW = 32_000;

/** The newest messages loaded for a thread; the budget cuts further. */
const HISTORY_LOAD_LIMIT = 200;
/** Assistant turns whose tool results are still shown; older ones keep only a note. */
const RECENT_ASSISTANT_TURNS = 2;
const TOOL_ARGS_CHARS = 200;

/** `min(0.6 × the model's context window, 120k)` tokens. */
export function historyBudgetTokens({ contextWindow }: { contextWindow: number | null }): number {
  return Math.min(Math.floor((contextWindow ?? UNKNOWN_CONTEXT_WINDOW) * HISTORY_CONTEXT_SHARE), HISTORY_MAX_TOKENS);
}

export interface HistoryMessage {
  id: string;
  role: ChatMessageRole;
  status: ChatMessageStatus;
  parts: ChatMessagePart[];
  plainText: string | null;
}

export interface HistoryAttachment {
  id: string;
  messageId: string | null;
  fileName: string;
  mimeType: string;
  kind: ChatAttachmentKind;
  pageCount: number | null;
  /** The whole text for the current message's attachments, an excerpt for earlier ones. */
  extractedText: string | null;
  imageData: Uint8Array | null;
}

export interface HistoryProposal {
  id: string;
  toolName: string;
  status: ChatProposalStatus;
  statusReason: string | null;
  /** The card's current arguments; shown to the model only for the card a comment is about. */
  args?: Record<string, unknown>;
}

type Wrap = UntrustedWrapper['wrap'];

interface RenderContext {
  attachments: Map<string, HistoryAttachment>;
  proposals: Map<string, HistoryProposal>;
  clarifications: Map<string, ChatClarificationPart>;
  wrap: Wrap;
}

const oneLine = ({ text }: { text: string }) => text.replace(/\s+/g, ' ').trim();

const describeAttachment = ({ attachment }: { attachment: HistoryAttachment }): string => {
  const pages = attachment.pageCount && attachment.kind !== 'image' ? `, ${attachment.pageCount} pages` : '';
  return `${attachment.kind}${pages}`;
};

/** An earlier attachment: a reference and a short excerpt. The model re-reads it with `read_attachment`. */
function renderEarlierAttachment({
  attachment,
  ctx,
}: {
  attachment: HistoryAttachment | undefined;
  ctx: RenderContext;
}) {
  if (!attachment) return '[an attached file that is no longer available]';

  const reference = `[attached file ${attachment.id}: ${attachment.fileName} (${describeAttachment({ attachment })})]`;
  if (attachment.kind === 'image') return `${reference} Sent as an image with that message; it is not shown again.`;

  const excerpt = (attachment.extractedText ?? '').slice(0, CHAT_ATTACHMENT_EXCERPT_CHARS);
  return [
    `${reference} Read it with read_attachment({"attachmentId":"${attachment.id}"}).`,
    ...(excerpt ? [ctx.wrap({ kind: 'attachment', text: excerpt })] : []),
  ].join('\n');
}

function renderUserText({ message, ctx }: { message: HistoryMessage; ctx: RenderContext }): string[] {
  const blocks: string[] = [];

  for (const part of message.parts) {
    switch (part.type) {
      case 'text':
        blocks.push(part.text);
        break;
      case 'cardComment': {
        const proposal = ctx.proposals.get(part.proposalId);
        blocks.push(
          proposal
            ? [
                `Comment on proposal ${proposal.id} (${proposal.toolName}, ${proposal.status}): ${part.text}`,
                `The arguments of that proposal:`,
                ctx.wrap({ kind: 'toolResult', text: JSON.stringify(proposal.args ?? {}) }),
              ].join('\n')
            : `Comment on proposal ${part.proposalId}: ${part.text}`,
        );
        break;
      }
      case 'clarificationAnswer': {
        const clarification = ctx.clarifications.get(part.clarificationId);
        const labels = part.optionIds.map(
          (id) => clarification?.options.find((option) => option.id === id)?.label ?? id,
        );
        const answer = [...labels, ...(part.freeText ? [part.freeText] : [])].join(', ');
        blocks.push(
          clarification ? `Answer to your question "${clarification.question}": ${answer}` : `Answer: ${answer}`,
        );
        break;
      }
      default:
        break;
    }
  }

  return blocks;
}

function renderEarlierUser({ message, ctx }: { message: HistoryMessage; ctx: RenderContext }): string {
  const attachments = message.parts.flatMap((part) =>
    part.type === 'attachment'
      ? [renderEarlierAttachment({ attachment: ctx.attachments.get(part.attachmentId), ctx })]
      : [],
  );

  return [...renderUserText({ message, ctx }), ...attachments].join('\n');
}

/**
 * The current message in full: a document as untrusted text (cut to a window that fits, with the
 * call that reads the rest) and an image as an image part.
 */
function renderCurrentUser({ message, ctx }: { message: HistoryMessage; ctx: RenderContext }): ModelMessage {
  const texts: string[] = renderUserText({ message, ctx });
  const images: ImagePart[] = [];
  let remaining = CHAT_READ_RESULT_MAX_CHARS;

  for (const part of message.parts) {
    if (part.type !== 'attachment') continue;

    const attachment = ctx.attachments.get(part.attachmentId);
    if (!attachment) {
      texts.push('[an attached file that is no longer available]');
      continue;
    }

    const label = `[attached file ${attachment.id}: ${attachment.fileName} (${describeAttachment({ attachment })})]`;
    if (attachment.kind === 'image' && attachment.imageData) {
      texts.push(label);
      images.push({ type: 'image', image: attachment.imageData, mediaType: attachment.mimeType });
      continue;
    }

    const full = attachment.extractedText ?? '';
    const shown = full.slice(0, Math.max(remaining, 0));
    remaining -= shown.length;
    texts.push(
      [
        label,
        ctx.wrap({ kind: 'attachment', text: shown }),
        ...(shown.length < full.length
          ? [
              `[Showing the first ${shown.length} of ${full.length} characters. Read the rest with read_attachment({"attachmentId":"${attachment.id}","offset":${shown.length}}).]`,
            ]
          : []),
      ].join('\n'),
    );
  }

  const text = texts.join('\n');
  if (images.length === 0) return { role: 'user', content: text };

  const textPart: TextPart = { type: 'text', text };
  return { role: 'user', content: [textPart, ...images] };
}

function renderToolCall({
  part,
  recent,
  ctx,
}: {
  part: ChatToolCallPart;
  recent: boolean;
  ctx: RenderContext;
}): string {
  const header = `[tool ${part.toolName}`;
  if (!recent)
    return `${header} ${part.status === 'error' ? 'failed' : 'ran'}; its result is not kept, call it again if needed]`;

  const args = JSON.stringify(part.args ?? {}).slice(0, TOOL_ARGS_CHARS);
  if (part.status === 'error') return `${header}(${args}) error: ${oneLine({ text: part.error ?? 'failed' })}]`;
  if (!part.resultSummary) return `${header}(${args}) ${part.status}]`;

  return [
    `${header}(${args}) ok; start of the result, call it again if you need all of it:]`,
    ctx.wrap({ kind: 'toolResult', text: part.resultSummary }),
  ].join('\n');
}

const describeVisual = ({ spec }: { spec: ChatVisualSpec }): string =>
  `[visual shown to the user: ${spec.type === 'chart' ? `${spec.kind} chart` : spec.type}]`;

function renderAssistant({
  message,
  recent,
  ctx,
}: {
  message: HistoryMessage;
  recent: boolean;
  ctx: RenderContext;
}): string {
  const lines: string[] = [];

  for (const part of message.parts) {
    switch (part.type) {
      case 'text':
        lines.push(part.text);
        break;
      case 'toolCall':
        lines.push(renderToolCall({ part, recent, ctx }));
        break;
      case 'proposal': {
        const proposal = ctx.proposals.get(part.proposalId);
        lines.push(
          proposal
            ? `proposal ${proposal.id} ${proposal.toolName}: ${proposal.status}${proposal.statusReason ? ` (${oneLine({ text: proposal.statusReason })})` : ''}`
            : `proposal ${part.proposalId}: unknown`,
        );
        break;
      }
      case 'clarification':
        lines.push(
          `You asked the user: "${part.question}"${part.options.length > 0 ? ` Options: ${part.options.map((option) => option.label).join(' | ')}.` : ''}`,
        );
        break;
      case 'visual':
        lines.push(describeVisual({ spec: part.spec }));
        break;
      default:
        break;
    }
  }

  return lines.join('\n');
}

/**
 * The thread as model messages: the newest turns that fit the budget, oldest first, ending with
 * the message the run answers (always kept, attachments in full). Older tool results shrink to a
 * note, cards render as one line with their state, and earlier attachments as a reference plus a
 * short excerpt. A turn that said nothing, and one still streaming, is left out.
 */
export function buildHistoryMessages({
  messages,
  attachments,
  proposals,
  currentMessageId,
  budgetTokens,
  wrap,
}: {
  messages: HistoryMessage[];
  attachments: HistoryAttachment[];
  proposals: HistoryProposal[];
  currentMessageId: string;
  budgetTokens: number;
  wrap: Wrap;
}): ModelMessage[] {
  const ctx: RenderContext = {
    attachments: new Map(attachments.map((attachment) => [attachment.id, attachment])),
    proposals: new Map(proposals.map((proposal) => [proposal.id, proposal])),
    clarifications: new Map(
      messages.flatMap((message) =>
        message.parts.flatMap((part) => (part.type === 'clarification' ? [[part.id, part] as const] : [])),
      ),
    ),
    wrap,
  };

  const currentIndex = messages.findIndex((message) => message.id === currentMessageId);
  const current = messages[currentIndex];
  const earlier = (currentIndex === -1 ? messages : messages.slice(0, currentIndex)).filter(
    (message) => message.status !== 'streaming',
  );
  const recentAssistantIds = new Set(
    earlier
      .filter((message) => message.role === 'assistant')
      .slice(-RECENT_ASSISTANT_TURNS)
      .map((message) => message.id),
  );

  const kept: ModelMessage[] = [];
  let used = 0;
  for (const message of earlier.toReversed()) {
    const content =
      message.role === 'user'
        ? renderEarlierUser({ message, ctx })
        : renderAssistant({ message, recent: recentAssistantIds.has(message.id), ctx });
    if (!content.trim()) continue;

    used += estimateTokenCount({ text: content });
    if (used > budgetTokens) break;

    kept.push({ role: message.role, content } as ModelMessage);
  }

  const history = kept.toReversed();
  // A conversation starts with the user's turn, whatever the budget cut.
  while (history[0]?.role === 'assistant') history.shift();

  return [...history, ...(current ? [renderCurrentUser({ message: current, ctx })] : [])];
}

/**
 * Loads a thread's messages, their attachments and cards, and builds the history for the run that
 * answers `currentUserMessageId`. `excludeMessageId` is the assistant message the run fills.
 */
export async function loadHistoryMessages({
  threadId,
  userId,
  currentUserMessageId,
  excludeMessageId,
  budgetTokens,
  wrap,
}: {
  threadId: string;
  userId: number;
  currentUserMessageId: string;
  excludeMessageId: string;
  budgetTokens: number;
  wrap: Wrap;
}): Promise<ModelMessage[]> {
  const rows = await ChatMessages.findAll({
    where: { threadId, userId, id: { [Op.ne]: excludeMessageId } },
    attributes: ['id', 'role', 'status', 'parts', 'plainText'],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: HISTORY_LOAD_LIMIT,
  });
  const messages = rows.toReversed();

  const messageIds = messages.map((message) => message.id);
  const [earlierRows, currentRows, proposalRows] = await Promise.all([
    ChatAttachments.findAll({
      where: { threadId, userId, messageId: { [Op.in]: messageIds.filter((id) => id !== currentUserMessageId) } },
      attributes: [
        'id',
        'messageId',
        'fileName',
        'mimeType',
        'kind',
        'pageCount',
        [fn('left', col('extractedText'), CHAT_ATTACHMENT_EXCERPT_CHARS), 'extractedText'],
      ],
      raw: true,
    }),
    ChatAttachments.findAll({
      where: { threadId, userId, messageId: currentUserMessageId },
      attributes: ['id', 'messageId', 'fileName', 'mimeType', 'kind', 'pageCount', 'extractedText', 'imageData'],
      raw: true,
    }),
    ChatProposals.findAll({
      where: { threadId, userId },
      attributes: ['id', 'toolName', 'status', 'statusReason', 'args'],
      raw: true,
    }),
  ]);

  const toAttachment = (row: object): HistoryAttachment => ({
    ...(row as HistoryAttachment),
    imageData: (row as { imageData?: Uint8Array | null }).imageData ?? null,
  });

  return buildHistoryMessages({
    messages: messages.map(({ id, role, status, parts, plainText }) => ({ id, role, status, parts, plainText })),
    attachments: [...earlierRows.map(toAttachment), ...currentRows.map(toAttachment)],
    proposals: proposalRows as unknown as HistoryProposal[],
    currentMessageId: currentUserMessageId,
    budgetTokens,
    wrap,
  });
}
