<script setup lang="ts">
import { Callout } from '@/components/lib/ui/callout';
import type { ChatEntityCell, ChatProposalCard, ChatTableCell, ChatTableSpec } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useChatText } from '../chat-text';
import ChatTable from '../visuals/chat-table.vue';
import type { ApprovalRequirement } from './card-chain';
import TypedConfirmation from './typed-confirmation.vue';
import type { CardLookups } from './use-card-lookups';

const props = defineProps<{
  card: ChatProposalCard;
  requirement: ApprovalRequirement;
  /** What the user typed, for a typed requirement. */
  typed: string;
  lookups: CardLookups;
}>();

const emit = defineEmits<{ 'update:typed': [value: string] }>();

const { t, te } = useI18n();
const { keyText } = useChatText();

const isEntityCell = (cell: ChatTableCell | undefined): cell is ChatEntityCell =>
  cell !== null && typeof cell === 'object';

/** The sample rows as a table: column labels are keys, and an entity cell is named from what the app holds. */
const sample = computed<ChatTableSpec | null>(() => {
  const affected = props.card.affected;
  if (!affected) return null;

  return {
    type: 'table',
    title: t('chat.cards.affected.count', { count: affected.count }),
    columns: affected.columns.map((column) => ({ ...column, label: keyText({ key: column.label }) ?? column.label })),
    rows: affected.rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, cell]) => {
          if (!isEntityCell(cell) || cell.label) return [key, cell];
          const name = props.lookups.entityName({ kind: cell.kind, id: cell.id });
          return [key, name ? { ...cell, label: name } : cell];
        }),
      ),
    ),
  };
});

const hiddenCount = computed(() => {
  const affected = props.card.affected;
  return affected ? Math.max(0, affected.count - affected.rows.length) : 0;
});

/** What goes with the target or is touched by the call, as `1 transfer leg, 2 splits`; a count the app has no label for is left out. */
const countsText = computed(() => {
  const labels = Object.entries(props.card.counts ?? {}).flatMap(([key, count]) => {
    const labelKey = `chat.cards.counts.items.${key}`;
    return count > 0 && te(labelKey) ? [t(labelKey, { count })] : [];
  });

  return labels.length > 0 ? t('chat.cards.counts.title', { items: labels.join(', ') }) : null;
});

const isDangerous = computed(() => props.card.danger !== 'none');
</script>

<template>
  <div v-if="isDangerous || card.egress || card.affected || countsText" class="flex flex-col gap-3">
    <Callout v-if="isDangerous" variant="destructive">
      {{ $t(card.danger === 'highImpact' ? 'chat.cards.danger.highImpact' : 'chat.cards.danger.destructive') }}
    </Callout>

    <p v-if="countsText" class="text-muted-foreground text-sm" data-testid="card-counts">{{ countsText }}</p>

    <div v-if="sample" class="flex flex-col gap-1">
      <ChatTable :spec="sample" />
      <p v-if="hiddenCount > 0" class="text-muted-foreground text-xs">
        {{ $t('chat.cards.affected.more', { count: hiddenCount }) }}
      </p>
    </div>

    <Callout v-if="card.egress" variant="warning" :title="$t('chat.cards.egress.title')">
      <p class="mb-2">{{ $t('chat.cards.egress.description') }}</p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt class="font-medium">{{ $t('chat.cards.egress.url') }}</dt>
        <dd class="font-mono wrap-anywhere" data-testid="egress-url">{{ card.egress.url }}</dd>
        <dt class="font-medium">{{ $t('chat.cards.egress.host') }}</dt>
        <dd class="font-mono wrap-anywhere" data-testid="egress-host">{{ card.egress.host }}</dd>
      </dl>
    </Callout>

    <div v-if="requirement.mode === 'typed'" data-testid="typed-confirmation">
      <TypedConfirmation
        :model-value="typed"
        :expected="requirement.expected"
        @update:model-value="emit('update:typed', $event)"
      />
    </div>
  </div>
</template>
