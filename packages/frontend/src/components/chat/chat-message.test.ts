import type { ChatMessage, ChatMessagePart, ChatProposalCard } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import { buildCard, createChatI18n } from './cards/card-test-fixtures';
import ChatMessageView from './chat-message.vue';

/** Children that matter here are the ones the message wires up; each stub shows what it was given. */
const stub = ({ testId, props }: { testId: string; props: string[] }) =>
  defineComponent({
    props,
    emits: ['answer', 'commented'],
    setup:
      (componentProps, { emit }) =>
      () =>
        h('div', {
          'data-testid': testId,
          'data-props': JSON.stringify(componentProps),
          onClick: () => {
            emit('answer', { clarificationId: 'cl1', optionIds: ['o1'] });
            emit('commented', { runId: 'run-2', messageId: 'm-2', userMessageId: 'u-2' });
          },
        }),
  });

const STUBS = {
  ProposalCard: stub({ testId: 'proposal-card', props: ['card', 'cards'] }),
  ApproveAllBar: stub({ testId: 'approve-all-bar', props: ['messageId', 'cards'] }),
  ClarificationCard: stub({ testId: 'clarification-card', props: ['part', 'disabled'] }),
  ChatChart: stub({ testId: 'chart', props: ['spec'] }),
  ChatTable: stub({ testId: 'table', props: ['spec'] }),
  ChatKpis: stub({ testId: 'kpis', props: ['spec'] }),
  AnalysisPart: stub({ testId: 'analysis', props: ['part'] }),
  ToolCallsDetails: stub({ testId: 'tool-calls', props: ['parts'] }),
  UserAttachment: defineComponent({
    props: ['part'],
    setup: (props) => () =>
      h('div', { 'data-testid': 'user-attachment', 'data-attachment-id': props.part.attachmentId }),
  }),
};

const message = (overrides: Partial<ChatMessage> & { parts: ChatMessagePart[] }): ChatMessage => ({
  id: 'm1',
  threadId: 't1',
  role: 'assistant',
  status: 'complete',
  plainText: null,
  pageContext: null,
  runId: null,
  provider: null,
  modelId: null,
  promptVersion: null,
  usage: null,
  stepCount: 0,
  error: null,
  createdAt: '2026-03-05T10:00:00.000Z',
  ...overrides,
});

const mountMessage = ({
  value,
  cards = {},
  isLive = false,
  canAnswer = true,
}: {
  value: ChatMessage;
  cards?: Record<string, ChatProposalCard>;
  isLive?: boolean;
  canAnswer?: boolean;
}) =>
  mount(ChatMessageView, {
    props: { message: value, cards, isLive, canAnswer },
    global: { plugins: [createChatI18n()], stubs: STUBS },
  });

const propsOf = ({
  wrapper,
  testId,
  index = 0,
}: {
  wrapper: ReturnType<typeof mountMessage>;
  testId: string;
  index?: number;
}) => JSON.parse(wrapper.findAll(`[data-testid="${testId}"]`)[index]!.attributes('data-props')!);

describe('ChatMessage', () => {
  describe('a user message', () => {
    it('shows what the user wrote', () => {
      const wrapper = mountMessage({
        value: message({ role: 'user', parts: [{ type: 'text', id: 'p1', text: 'How much did I spend?' }] }),
      });

      expect(wrapper.find('[data-testid="user-message"]').text()).toContain('How much did I spend?');
    });

    it('shows text as characters, never as markup', () => {
      const wrapper = mountMessage({
        value: message({ role: 'user', parts: [{ type: 'text', id: 'p1', text: '<img src=x onerror=alert(1)>' }] }),
      });

      expect(wrapper.find('img').exists()).toBe(false);
      expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    });

    it('shows each attachment of the message', () => {
      const wrapper = mountMessage({
        value: message({
          role: 'user',
          parts: [
            { type: 'text', id: 'p1', text: 'See this' },
            { type: 'attachment', id: 'p2', attachmentId: 'att-1' },
            { type: 'attachment', id: 'p3', attachmentId: 'att-2' },
          ],
        }),
      });

      expect(wrapper.findAll('[data-testid="user-attachment"]')).toHaveLength(2);
      expect(
        wrapper.findAll('[data-testid="user-attachment"]').map((item) => item.attributes('data-attachment-id')),
      ).toEqual(['att-1', 'att-2']);
    });

    it('shows the comment on a card as a comment', () => {
      const wrapper = mountMessage({
        value: message({
          role: 'user',
          parts: [{ type: 'cardComment', id: 'p1', proposalId: 'c1', text: 'Use the other account' }],
        }),
      });

      expect(wrapper.text()).toContain('Comment on a card');
      expect(wrapper.text()).toContain('Use the other account');
    });

    it('shows the answer to a question through the text the server kept', () => {
      const wrapper = mountMessage({
        value: message({
          role: 'user',
          plainText: 'Main card',
          parts: [{ type: 'clarificationAnswer', id: 'p1', clarificationId: 'cl1', optionIds: ['o1'] }],
        }),
      });

      expect(wrapper.find('[data-testid="user-message"]').text()).toContain('Main card');
    });
  });

  describe('an assistant message', () => {
    it('renders text through the safe renderer', () => {
      const wrapper = mountMessage({
        value: message({ parts: [{ type: 'text', id: 'p1', text: 'You spent **120** on food. <b>x</b>' }] }),
      });

      expect(wrapper.find('strong').text()).toBe('120');
      expect(wrapper.find('b').exists()).toBe(false);
      expect(wrapper.text()).toContain('<b>x</b>');
    });

    it('draws each visual with the component for its kind', () => {
      const wrapper = mountMessage({
        value: message({
          parts: [
            { type: 'visual', id: 'v1', spec: { type: 'kpis', items: [] } },
            { type: 'visual', id: 'v2', spec: { type: 'table', title: 'T', columns: [], rows: [] } },
            {
              type: 'visual',
              id: 'v3',
              spec: {
                type: 'chart',
                kind: 'donut',
                title: 'C',
                unit: { kind: 'number' },
                slices: [],
              },
            },
          ],
        }),
      });

      expect(wrapper.find('[data-testid="kpis"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="table"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="chart"]').exists()).toBe(true);
    });

    it('shows a card per proposal with a header and the approve-all bar', () => {
      const first = buildCard({ id: 'c1' });
      const second = buildCard({ id: 'c2' });
      const wrapper = mountMessage({
        value: message({
          parts: [
            { type: 'proposal', id: 'p1', proposalId: 'c1' },
            { type: 'proposal', id: 'p2', proposalId: 'c2' },
          ],
        }),
        cards: { c1: first, c2: second },
      });

      expect(wrapper.find('[data-testid="proposals-header"]').text()).toBe('2 proposed changes');
      expect(wrapper.findAll('[data-testid="proposal-card"]')).toHaveLength(2);
      expect(propsOf({ wrapper, testId: 'proposal-card' }).card.id).toBe('c1');
      expect(Object.keys(propsOf({ wrapper, testId: 'proposal-card' }).cards)).toEqual(['c1', 'c2']);
      expect(propsOf({ wrapper, testId: 'approve-all-bar' })).toMatchObject({ messageId: 'm1' });
      expect(propsOf({ wrapper, testId: 'approve-all-bar' }).cards.map((card: ChatProposalCard) => card.id)).toEqual([
        'c1',
        'c2',
      ]);
    });

    it('uses the singular for one card', () => {
      const wrapper = mountMessage({
        value: message({ parts: [{ type: 'proposal', id: 'p1', proposalId: 'c1' }] }),
        cards: { c1: buildCard({ id: 'c1' }) },
      });

      expect(wrapper.find('[data-testid="proposals-header"]').text()).toBe('1 proposed change');
    });

    it('says so when a card is gone instead of leaving a hole', () => {
      const wrapper = mountMessage({
        value: message({ parts: [{ type: 'proposal', id: 'p1', proposalId: 'missing' }] }),
      });

      expect(wrapper.find('[data-testid="proposal-card"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('This card is no longer available.');
    });

    it('passes a comment on a card up as the run to follow', async () => {
      const wrapper = mountMessage({
        value: message({ parts: [{ type: 'proposal', id: 'p1', proposalId: 'c1' }] }),
        cards: { c1: buildCard({ id: 'c1' }) },
      });

      await wrapper.find('[data-testid="proposal-card"]').trigger('click');

      expect(wrapper.emitted('commented')).toEqual([[{ runId: 'run-2', messageId: 'm-2', userMessageId: 'u-2' }]]);
    });

    it('passes the answer to a question up, and locks the card while it cannot be answered', async () => {
      const part: ChatMessagePart = {
        type: 'clarification',
        id: 'cl1',
        question: 'Which account?',
        options: [{ id: 'o1', label: 'Main' }],
        allowFreeText: false,
        multiSelect: false,
      };
      const wrapper = mountMessage({ value: message({ parts: [part] }), canAnswer: false });

      expect(propsOf({ wrapper, testId: 'clarification-card' }).disabled).toBe(true);

      await wrapper.find('[data-testid="clarification-card"]').trigger('click');

      expect(wrapper.emitted('answer')).toEqual([[{ clarificationId: 'cl1', optionIds: ['o1'] }]]);
    });

    it('collects the lookups into one details list', () => {
      const wrapper = mountMessage({
        value: message({
          parts: [
            { type: 'toolCall', id: 'a', callId: '1', toolName: 'list_accounts', args: {}, status: 'ok' },
            { type: 'text', id: 't', text: 'Done' },
            { type: 'toolCall', id: 'b', callId: '2', toolName: 'get_stats', args: {}, status: 'ok' },
          ],
        }),
      });

      expect(wrapper.findAll('[data-testid="tool-calls"]')).toHaveLength(1);
      expect(propsOf({ wrapper, testId: 'tool-calls' }).parts).toHaveLength(2);
    });

    it('shows a notice with its text', () => {
      const wrapper = mountMessage({
        value: message({ parts: [{ type: 'notice', id: 'n1', key: 'chat.notices.stepLimit', params: { limit: 25 } }] }),
      });

      expect(wrapper.text()).toContain('Stopped after 25 steps.');
    });

    it('shows an error part by its key, and a generic line for a key it does not know', () => {
      const known = mountMessage({
        value: message({
          status: 'failed',
          parts: [{ type: 'error', id: 'e1', code: 'rateLimited', messageKey: 'chat.errors.rateLimited' }],
        }),
      });
      const unknown = mountMessage({
        value: message({
          status: 'failed',
          parts: [{ type: 'error', id: 'e1', code: 'future', messageKey: 'chat.errors.futureCode' }],
        }),
      });

      expect(known.find('[data-testid="message-error"]').text()).toContain('The provider is limiting requests.');
      expect(unknown.find('[data-testid="message-error"]').text()).toContain('Something went wrong while answering.');
    });

    it('shows the error of a failed message that has no error part', () => {
      const wrapper = mountMessage({
        value: message({
          status: 'failed',
          parts: [],
          error: { code: 'timeout', messageKey: 'chat.errors.timeout' },
        }),
      });

      expect(wrapper.find('[data-testid="message-error"]').text()).toContain('The answer took too long');
    });

    it('shows a thinking line while a live run has produced nothing yet', () => {
      const wrapper = mountMessage({ value: message({ status: 'streaming', parts: [] }), isLive: true });

      expect(wrapper.find('[data-testid="thinking"]').exists()).toBe(true);
    });

    it('does not show the thinking line once there is something to read', () => {
      const wrapper = mountMessage({
        value: message({ status: 'streaming', parts: [{ type: 'text', id: 'p1', text: 'Looking' }] }),
        isLive: true,
      });

      expect(wrapper.find('[data-testid="thinking"]').exists()).toBe(false);
    });

    it('shows an analysis part', () => {
      const wrapper = mountMessage({
        value: message({
          parts: [{ type: 'analysis', id: 'a1', code: '1+1', inputs: [], status: 'ok' }],
        }),
      });

      expect(wrapper.find('[data-testid="analysis"]').exists()).toBe(true);
    });
  });
});
