<script setup lang="ts">
import type {
  ChatAttachmentPart,
  ChatClarificationAnswerInput,
  ChatMessage,
  ChatMessagePart,
  ChatProposalCard,
  ChatSendMessageResponse,
  ChatToolCallPart,
} from '@bt/shared/types';
import { computed } from 'vue';

import ApproveAllBar from './cards/approve-all-bar.vue';
import ProposalCard from './cards/proposal-card.vue';
import { useChatText } from './chat-text';
import AnalysisPart from './parts/analysis-part.vue';
import ClarificationCard from './parts/clarification-card.vue';
import NoticePart from './parts/notice-part.vue';
import ToolCallsDetails from './parts/tool-calls-details.vue';
import UserAttachment from './parts/user-attachment.vue';
import SafeText from './safe-text.vue';
import ChatChart from './visuals/chat-chart.vue';
import ChatKpis from './visuals/chat-kpis.vue';
import ChatTable from './visuals/chat-table.vue';

const props = defineProps<{
  message: ChatMessage;
  /** The cards of the thread, by id. */
  cards: Record<string, ChatProposalCard>;
  /** The run that fills this message is streaming now. */
  isLive: boolean;
  /** A question in this message can be answered. */
  canAnswer: boolean;
}>();

const emit = defineEmits<{
  answer: [answer: ChatClarificationAnswerInput];
  commented: [response: ChatSendMessageResponse];
}>();

const { keyText } = useChatText();

const isUser = computed(() => props.message.role === 'user');

const userTexts = computed(() =>
  props.message.parts.flatMap((part) => (part.type === 'text' && part.text !== '' ? [part.text] : [])),
);
const userComments = computed(() =>
  props.message.parts.flatMap((part) => (part.type === 'cardComment' ? [part.text] : [])),
);
const hasClarificationAnswer = computed(() => props.message.parts.some((part) => part.type === 'clarificationAnswer'));
/** The server keeps the answer as text on the message; the part itself only holds option ids. */
const answerText = computed(() => (hasClarificationAnswer.value ? (props.message.plainText ?? '') : ''));
const attachmentParts = computed(() =>
  props.message.parts.filter((part): part is ChatAttachmentPart => part.type === 'attachment'),
);

const proposalParts = computed(() => props.message.parts.filter((part) => part.type === 'proposal'));
const firstProposalPartId = computed(() => proposalParts.value[0]?.id ?? null);
const lastProposalPartId = computed(() => proposalParts.value.at(-1)?.id ?? null);
const proposalCards = computed(() =>
  proposalParts.value.flatMap((part) => {
    const card = props.cards[part.proposalId];
    return card ? [card] : [];
  }),
);

/** The lookups of a message are one list at its end, not a line between the answer's parts. */
const toolCalls = computed(() =>
  props.message.parts.filter((part): part is ChatToolCallPart => part.type === 'toolCall'),
);
const shownParts = computed(() => props.message.parts.filter((part) => part.type !== 'toolCall'));

const hasErrorPart = computed(() => props.message.parts.some((part) => part.type === 'error'));
const messageErrorKey = computed(() => (hasErrorPart.value ? null : (props.message.error?.messageKey ?? null)));

/** A key this build does not know reads as a generic line, not as the key. */
const errorText = ({ key }: { key: string }) => keyText({ key, fallbackKey: 'chat.errors.unknown' });

const isThinking = computed(() => props.isLive && props.message.parts.length === 0);

const partKey = ({ part }: { part: ChatMessagePart }) => part.id;
</script>

<template>
  <div v-if="isUser" class="flex justify-end">
    <div
      class="bg-primary/10 flex max-w-[85%] min-w-0 flex-col gap-1.5 rounded-2xl rounded-br-sm px-3.5 py-2"
      data-testid="user-message"
    >
      <p v-for="(text, index) in userTexts" :key="index" class="text-sm wrap-anywhere whitespace-pre-wrap">
        {{ text }}
      </p>
      <template v-if="userComments.length > 0">
        <p class="text-muted-foreground text-xs font-medium">{{ $t('chat.message.comment') }}</p>
        <p v-for="(text, index) in userComments" :key="index" class="text-sm wrap-anywhere whitespace-pre-wrap">
          {{ text }}
        </p>
      </template>
      <p v-if="answerText" class="text-sm wrap-anywhere whitespace-pre-wrap">{{ answerText }}</p>
      <div v-if="attachmentParts.length > 0" class="flex flex-wrap gap-1.5">
        <UserAttachment
          v-for="attachment in attachmentParts"
          :key="attachment.id"
          :part="attachment"
          data-testid="user-attachment"
          :data-attachment-id="attachment.attachmentId"
        />
      </div>
    </div>
  </div>

  <div v-else class="flex min-w-0 flex-col gap-3" data-testid="assistant-message">
    <template v-for="part in shownParts" :key="partKey({ part })">
      <SafeText v-if="part.type === 'text'" :text="part.text" />

      <template v-else-if="part.type === 'visual'">
        <ChatChart v-if="part.spec.type === 'chart'" :spec="part.spec" />
        <ChatTable v-else-if="part.spec.type === 'table'" :spec="part.spec" />
        <ChatKpis v-else :spec="part.spec" />
      </template>

      <template v-else-if="part.type === 'proposal'">
        <p v-if="part.id === firstProposalPartId" class="text-sm font-medium" data-testid="proposals-header">
          {{ $t('chat.message.proposedChanges', { count: proposalParts.length }, proposalParts.length) }}
        </p>
        <ProposalCard
          v-if="cards[part.proposalId]"
          :card="cards[part.proposalId]!"
          :cards="cards"
          @commented="(response) => emit('commented', response)"
        />
        <p v-else class="text-muted-foreground text-sm">{{ $t('chat.message.cardUnavailable') }}</p>
        <ApproveAllBar v-if="part.id === lastProposalPartId" :message-id="message.id" :cards="proposalCards" />
      </template>

      <ClarificationCard
        v-else-if="part.type === 'clarification'"
        :part="part"
        :disabled="!canAnswer"
        @answer="(answer) => emit('answer', answer)"
      />

      <AnalysisPart v-else-if="part.type === 'analysis'" :part="part" />
      <NoticePart v-else-if="part.type === 'notice'" :part="part" />

      <p
        v-else-if="part.type === 'error'"
        class="border-destructive/30 bg-destructive/5 text-destructive-text rounded-lg border px-3 py-2 text-sm"
        role="alert"
        data-testid="message-error"
      >
        {{ errorText({ key: part.messageKey }) }}
      </p>
    </template>

    <p
      v-if="messageErrorKey"
      class="border-destructive/30 bg-destructive/5 text-destructive-text rounded-lg border px-3 py-2 text-sm"
      role="alert"
      data-testid="message-error"
    >
      {{ errorText({ key: messageErrorKey }) }}
    </p>

    <ToolCallsDetails :parts="toolCalls" />

    <p v-if="isThinking" class="text-muted-foreground flex items-center gap-1.5 text-sm" data-testid="thinking">
      <span class="bg-muted-foreground size-1.5 animate-pulse rounded-full" aria-hidden="true" />
      {{ $t('chat.conversation.thinking') }}
    </p>
  </div>
</template>
