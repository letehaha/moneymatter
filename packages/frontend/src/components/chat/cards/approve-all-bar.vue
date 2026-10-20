<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { useChatCardActions } from '@/composable/data-queries/chat';
import type { ChatApproveAllResponse, ChatProposalCard } from '@bt/shared/types';
import { CheckCheckIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useChatText } from '../chat-text';

const props = defineProps<{
  /** The assistant message whose cards the bar covers. */
  messageId: string;
  /** Every card of that message. */
  cards: ChatProposalCard[];
}>();

const { t } = useI18n();
const { keyText, titleText } = useChatText();
const { addSuccessNotification } = useNotificationCenter();
const { approveAll } = useChatCardActions();

/**
 * Why a card is not part of the pass, as the server words it for a card it skips: the order is the
 * server's, so what the bar names is what the server would say.
 */
const skipReasonKey = ({ card }: { card: ChatProposalCard }): string => {
  if (card.stale) return card.stale.reasonKey;
  if (!card.canApply.ok) return card.canApply.reasonKey;
  if (card.egress) return 'chat.cards.needsHostConfirmation';
  if (card.confirmation.mode !== 'none' || card.danger !== 'none') return 'chat.cards.needsConfirmation';
  if (card.fields.some((field) => field.uncertain)) return 'chat.cards.hasUncertainFields';
  return 'chat.cards.needsReview';
};

const pending = computed(() => props.cards.filter((card) => card.status === 'pending'));
const safeCount = computed(() => pending.value.filter((card) => card.safe).length);
const skipped = computed(() =>
  pending.value
    .filter((card) => !card.safe)
    .map((card) => ({
      id: card.id,
      title: titleText({ title: card.title }),
      reason: keyText({ key: skipReasonKey({ card }), fallbackKey: 'chat.cards.needsReview' }) ?? '',
    })),
);

const announce = ({ response }: { response: ChatApproveAllResponse }) => {
  const applied = response.results.filter((result) => result.outcome === 'applied').length;
  const left = response.results.length - applied;

  addSuccessNotification(
    left === 0
      ? t('chat.cards.approveAll.applied', { count: applied })
      : t('chat.cards.approveAll.partial', { applied, left }),
  );
};

const approve = () => {
  approveAll.mutate(
    {
      messageId: props.messageId,
      // The server decides which cards are safe; it needs the revision the user saw of each pending one.
      payload: { revisions: Object.fromEntries(pending.value.map((card) => [card.id, card.revision])) },
    },
    { onSuccess: (response) => announce({ response }) },
  );
};
</script>

<template>
  <div v-if="safeCount > 0" class="bg-card flex flex-col gap-2 rounded-xl border p-3">
    <div class="flex flex-wrap items-center gap-3">
      <Button
        variant="soft-success"
        size="sm"
        data-testid="approve-all"
        :disabled="approveAll.isPending.value"
        @click="approve"
      >
        <CheckCheckIcon class="size-4" aria-hidden="true" />
        {{ $t('chat.cards.approveAll.button', { count: safeCount }) }}
      </Button>
    </div>

    <div v-if="skipped.length > 0" class="text-muted-foreground text-sm">
      <p class="font-medium">{{ $t('chat.cards.approveAll.skippedTitle', { count: skipped.length }) }}</p>
      <ul class="mt-1 flex flex-col gap-0.5">
        <li v-for="item in skipped" :key="item.id" data-testid="skipped-card">
          <span class="text-foreground">{{ item.title }}</span>
          <span> · {{ item.reason }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
