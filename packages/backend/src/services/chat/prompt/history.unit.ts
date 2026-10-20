import type { ChatMessagePart } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import type { ModelMessage } from 'ai';

import {
  buildHistoryMessages,
  historyBudgetTokens,
  type HistoryAttachment,
  type HistoryMessage,
  type HistoryProposal,
} from './history';

const long = (label: string) => `${label} ${'word '.repeat(400)}`;

const wrap = ({ kind, text }: { kind: string; text: string }) => `<<${kind}>>${text}<</${kind}>>`;

const text = ({ id, value }: { id: string; value: string }): ChatMessagePart => ({ type: 'text', id, text: value });

const user = ({ id, value, parts }: { id: string; value: string; parts?: ChatMessagePart[] }): HistoryMessage => ({
  id,
  role: 'user',
  status: 'complete',
  parts: parts ?? [text({ id: `${id}-t`, value })],
  plainText: value,
});

const assistant = ({
  id,
  parts,
  status = 'complete',
}: {
  id: string;
  parts: ChatMessagePart[];
  status?: HistoryMessage['status'];
}): HistoryMessage => ({ id, role: 'assistant', status, parts, plainText: null });

const build = (overrides: Partial<Parameters<typeof buildHistoryMessages>[0]> & { messages: HistoryMessage[] }) =>
  buildHistoryMessages({
    attachments: [],
    proposals: [],
    currentMessageId: overrides.messages.at(-1)!.id,
    budgetTokens: 100_000,
    wrap,
    ...overrides,
  });

const contentOf = (message: ModelMessage | undefined): string =>
  typeof message?.content === 'string'
    ? message.content
    : (message?.content ?? []).map((part) => ('text' in part ? part.text : `[${part.type}]`)).join('\n');

const toolCall = ({
  id,
  name,
  summary,
  status = 'ok',
}: {
  id: string;
  name: string;
  summary?: string;
  status?: 'ok' | 'error';
}): ChatMessagePart => ({
  type: 'toolCall',
  id: `p-${id}`,
  callId: id,
  toolName: name,
  args: { from: '2026-09-01' },
  status,
  ...(status === 'ok' ? { resultSummary: summary } : { error: summary }),
});

describe('buildHistoryMessages', () => {
  it('turns plain turns into model messages, oldest first, ending with the current message', () => {
    const result = build({
      messages: [
        user({ id: 'u1', value: 'Hello' }),
        assistant({ id: 'a1', parts: [text({ id: 't', value: 'Hi there' })] }),
        user({ id: 'u2', value: 'What did I spend?' }),
      ],
    });

    expect(result.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(contentOf(result[0])).toBe('Hello');
    expect(contentOf(result[1])).toBe('Hi there');
    expect(contentOf(result[2])).toContain('What did I spend?');
  });

  it('keeps the newest turns within the budget, starts on a user turn and always keeps the current message', () => {
    const messages = [
      user({ id: 'u1', value: long('first') }),
      assistant({ id: 'a1', parts: [text({ id: 't1', value: long('answer-one') })] }),
      user({ id: 'u2', value: long('second') }),
      assistant({ id: 'a2', parts: [text({ id: 't2', value: long('answer-two') })] }),
      user({ id: 'u3', value: 'current question' }),
    ];

    const result = build({ messages, budgetTokens: 900 });
    const joined = result.map(contentOf).join('\n');

    expect(joined).toContain('current question');
    expect(joined).toContain('answer-two');
    expect(joined).not.toContain('first word');
    expect(joined).not.toContain('answer-one');
    expect(result[0]!.role).toBe('user');
    expect(result.at(-1)!.role).toBe('user');
  });

  it('keeps only the current message when the budget has no room for history', () => {
    const result = build({
      messages: [
        user({ id: 'u1', value: 'word '.repeat(500) }),
        assistant({ id: 'a1', parts: [text({ id: 't', value: 'word '.repeat(500) })] }),
        user({ id: 'u2', value: 'now' }),
      ],
      budgetTokens: 10,
    });

    expect(result).toHaveLength(1);
    expect(contentOf(result[0])).toContain('now');
  });

  it('compacts tool results: the last two assistant turns keep their summary, older ones keep a note', () => {
    const turn = ({ n, summary }: { n: number; summary: string }) => [
      user({ id: `u${n}`, value: `question ${n}` }),
      assistant({
        id: `a${n}`,
        parts: [
          toolCall({ id: `c${n}`, name: 'get_categories', summary }),
          text({ id: `t${n}`, value: `answer ${n}` }),
        ],
      }),
    ];

    const result = build({
      messages: [
        ...turn({ n: 1, summary: 'SUMMARY-ONE' }),
        ...turn({ n: 2, summary: 'SUMMARY-TWO' }),
        ...turn({ n: 3, summary: 'SUMMARY-THREE' }),
        user({ id: 'u4', value: 'current' }),
      ],
    });
    const joined = result.map(contentOf).join('\n');

    expect(joined).not.toContain('SUMMARY-ONE');
    expect(joined).toContain('SUMMARY-TWO');
    expect(joined).toContain('SUMMARY-THREE');
    expect(contentOf(result[1])).toContain('get_categories');
    expect(contentOf(result[1])).toMatch(/call (it )?again if needed/i);
    expect(contentOf(result[1])).toContain('answer 1');
  });

  it('renders a failed tool call with its error', () => {
    const result = build({
      messages: [
        user({ id: 'u1', value: 'q' }),
        assistant({
          id: 'a1',
          parts: [toolCall({ id: 'c1', name: 'get_accounts', summary: 'boom', status: 'error' })],
        }),
        user({ id: 'u2', value: 'again' }),
      ],
    });

    expect(contentOf(result[1])).toMatch(/get_accounts[^\n]*error[^\n]*boom/i);
  });

  it('renders every card as one line with its state', () => {
    const proposals: HistoryProposal[] = [
      { id: 'p-applied', toolName: 'create_category', status: 'applied', statusReason: null },
      { id: 'p-rejected', toolName: 'create_transaction', status: 'rejected', statusReason: 'wrong amount' },
      { id: 'p-pending', toolName: 'update_account', status: 'pending', statusReason: null },
    ];

    const result = build({
      proposals,
      messages: [
        user({ id: 'u1', value: 'log my receipts' }),
        assistant({
          id: 'a1',
          parts: proposals.map(({ id }) => ({ type: 'proposal' as const, id: `part-${id}`, proposalId: id })),
        }),
        user({ id: 'u2', value: 'thanks' }),
      ],
    });
    const lines = contentOf(result[1]).split('\n');

    expect(lines).toContain('proposal p-applied create_category: applied');
    expect(lines).toContain('proposal p-rejected create_transaction: rejected (wrong amount)');
    expect(lines).toContain('proposal p-pending update_account: pending');
  });

  it('renders a visual as a one-line note, not its data', () => {
    const result = build({
      messages: [
        user({ id: 'u1', value: 'chart please' }),
        assistant({
          id: 'a1',
          parts: [
            {
              type: 'visual',
              id: 'v1',
              spec: { type: 'kpis', items: [{ label: 'Spent', value: 12 }] } as never,
            },
          ],
        }),
        user({ id: 'u2', value: 'ok' }),
      ],
    });

    expect(contentOf(result[1])).toMatch(/\[(chart|table|kpis|visual)/i);
    expect(contentOf(result[1])).not.toContain('"value":12');
  });

  it('shows a clarification and its answer, with the labels the user chose', () => {
    const result = build({
      messages: [
        user({ id: 'u1', value: 'log the taxi' }),
        assistant({
          id: 'a1',
          parts: [
            {
              type: 'clarification',
              id: 'cl1',
              question: 'Which account?',
              options: [
                { id: 'o1', label: 'Visa' },
                { id: 'o2', label: 'Cash' },
              ],
              allowFreeText: true,
              multiSelect: false,
              answer: { optionIds: ['o2'], freeText: 'the old one' },
            },
          ],
        }),
        {
          id: 'u2',
          role: 'user',
          status: 'complete',
          plainText: 'Cash, the old one',
          parts: [
            {
              type: 'clarificationAnswer',
              id: 'ans',
              clarificationId: 'cl1',
              optionIds: ['o2'],
              freeText: 'the old one',
            },
          ],
        },
      ],
    });

    expect(contentOf(result[1])).toContain('Which account?');
    expect(contentOf(result[1])).toContain('Visa');
    expect(contentOf(result[2])).toContain('Which account?');
    expect(contentOf(result[2])).toContain('Cash');
    expect(contentOf(result[2])).toContain('the old one');
  });

  it('drops assistant turns that said nothing and turns still streaming', () => {
    const result = build({
      messages: [
        user({ id: 'u1', value: 'one' }),
        assistant({ id: 'a1', parts: [], status: 'cancelled' }),
        user({ id: 'u2', value: 'two' }),
        assistant({ id: 'a2', parts: [text({ id: 't', value: 'partial' })], status: 'streaming' }),
        user({ id: 'u3', value: 'three' }),
      ],
    });

    expect(result.map((message) => message.role)).toEqual(['user', 'user', 'user']);
  });

  it('shows earlier attachments as a reference with a wrapped excerpt and no pixels', () => {
    const attachments: HistoryAttachment[] = [
      {
        id: 'att-pdf',
        messageId: 'u1',
        fileName: 'statement.pdf',
        mimeType: 'application/pdf',
        kind: 'pdf',
        pageCount: 3,
        extractedText: 'Opening balance 100.00 '.repeat(100),
        imageData: null,
      },
      {
        id: 'att-img',
        messageId: 'u1',
        fileName: 'receipt.png',
        mimeType: 'image/png',
        kind: 'image',
        pageCount: 1,
        extractedText: null,
        imageData: new Uint8Array([1, 2, 3]),
      },
    ];

    const result = build({
      attachments,
      messages: [
        user({
          id: 'u1',
          value: 'import these',
          parts: [
            text({ id: 't', value: 'import these' }),
            { type: 'attachment', id: 'ap1', attachmentId: 'att-pdf' },
            { type: 'attachment', id: 'ap2', attachmentId: 'att-img' },
          ],
        }),
        assistant({ id: 'a1', parts: [text({ id: 'at', value: 'done' })] }),
        user({ id: 'u2', value: 'and now?' }),
      ],
    });
    const earlier = contentOf(result[0]);

    expect(earlier).toContain('import these');
    expect(earlier).toContain('att-pdf');
    expect(earlier).toContain('statement.pdf');
    expect(earlier).toContain('read_attachment');
    expect(earlier).toContain('<<attachment>>Opening balance');
    expect(earlier.length).toBeLessThan(2_000);
    expect(earlier).toContain('att-img');
    expect(earlier).not.toContain('[image]');
    expect(typeof result[0]!.content === 'string' || result[0]!.content.every((part) => part.type !== 'image')).toBe(
      true,
    );
  });

  it('sends the current message attachments in full: documents as wrapped text, images as image parts', () => {
    const attachments: HistoryAttachment[] = [
      {
        id: 'att-pdf',
        messageId: 'u1',
        fileName: 'statement.pdf',
        mimeType: 'application/pdf',
        kind: 'pdf',
        pageCount: 2,
        extractedText: 'Closing balance 980.45',
        imageData: null,
      },
      {
        id: 'att-img',
        messageId: 'u1',
        fileName: 'receipt.png',
        mimeType: 'image/png',
        kind: 'image',
        pageCount: 1,
        extractedText: null,
        imageData: new Uint8Array([137, 80, 78, 71]),
      },
    ];

    const result = build({
      attachments,
      messages: [
        user({
          id: 'u1',
          value: 'import these',
          parts: [
            text({ id: 't', value: 'import these' }),
            { type: 'attachment', id: 'ap1', attachmentId: 'att-pdf' },
            { type: 'attachment', id: 'ap2', attachmentId: 'att-img' },
          ],
        }),
      ],
    });
    const content = result[0]!.content;

    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string; text?: string; image?: unknown; mediaType?: string }>;
    expect(parts.some((part) => part.type === 'text' && part.text!.includes('import these'))).toBe(true);
    expect(
      parts.some((part) => part.type === 'text' && part.text!.includes('<<attachment>>Closing balance 980.45')),
    ).toBe(true);
    const image = parts.find((part) => part.type === 'image');
    expect(image).toMatchObject({ mediaType: 'image/png' });
    expect(Buffer.from(image!.image as Uint8Array).equals(Buffer.from([137, 80, 78, 71]))).toBe(true);
  });

  it('inlines a long document only up to a window and says how to read the rest', () => {
    const attachments: HistoryAttachment[] = [
      {
        id: 'att-long',
        messageId: 'u1',
        fileName: 'big.csv',
        mimeType: 'text/csv',
        kind: 'csv',
        pageCount: null,
        extractedText: 'x'.repeat(150_000),
        imageData: null,
      },
    ];

    const result = build({
      attachments,
      messages: [
        user({
          id: 'u1',
          value: 'go',
          parts: [text({ id: 't', value: 'go' }), { type: 'attachment', id: 'ap', attachmentId: 'att-long' }],
        }),
      ],
    });
    const joined = contentOf(result[0]);

    expect(joined.length).toBeLessThan(60_000);
    expect(joined).toMatch(/read_attachment[^\n]*att-long[^\n]*offset/i);
  });

  it('renders a comment the user left on a card', () => {
    const result = build({
      messages: [
        {
          id: 'u1',
          role: 'user',
          status: 'complete',
          plainText: null,
          parts: [{ type: 'cardComment', id: 'cc', proposalId: 'p-1', text: 'use the Visa account' }],
        },
      ],
    });

    expect(contentOf(result[0])).toContain('p-1');
    expect(contentOf(result[0])).toContain('use the Visa account');
  });
});

describe('historyBudgetTokens', () => {
  it('is 60% of the context window, capped at 120k', () => {
    expect(historyBudgetTokens({ contextWindow: 100_000 })).toBe(60_000);
    expect(historyBudgetTokens({ contextWindow: 1_000_000 })).toBe(120_000);
  });

  it('assumes a small window when the catalog does not know the model', () => {
    expect(historyBudgetTokens({ contextWindow: null })).toBe(19_200);
  });

  it('shows the card a comment is about: its tool, state and arguments, wrapped as untrusted data', () => {
    const result = build({
      messages: [
        {
          id: 'u1',
          role: 'user',
          status: 'complete',
          plainText: null,
          parts: [{ type: 'cardComment', id: 'cc', proposalId: 'p-1', text: 'Call it Groceries' }],
        },
      ],
      proposals: [
        { id: 'p-1', toolName: 'create_category', status: 'pending', statusReason: null, args: { name: 'Food' } },
      ],
    });

    const content = contentOf(result[0]);
    expect(content).toContain('Comment on proposal p-1 (create_category, pending): Call it Groceries');
    expect(content).toContain('<<toolResult>>{"name":"Food"}<</toolResult>>');
  });
});
