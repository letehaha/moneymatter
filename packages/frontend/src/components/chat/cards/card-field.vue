<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { cn } from '@/lib/utils';
import type { ChatCardDependency, ChatCardField, ChatUncertaintyReason } from '@bt/shared/types';
import { TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useChatText } from '../chat-text';
import { chatEntityRoute } from '../entity-route';
import { formatVisualDate, formatVisualValue } from '../visuals/format-visual-value';
import { fieldEntityKind, proposalRefId, summarizeValue } from './card-values';
import { describeMatchingRules } from './matching-rules';
import type { CardLookups } from './use-card-lookups';

const props = defineProps<{
  field: ChatCardField;
  lookups: CardLookups;
  /** The currency of a money field; `null` when the card does not say. */
  currencyCode: string | null;
  /** The cards this one depends on, to name a `$proposal:` ref. */
  dependsOn: ChatCardDependency[];
  /** The alternatives are not offered while the card cannot be changed. */
  disabled?: boolean;
}>();

const emit = defineEmits<{ choose: [value: unknown] }>();

const { t } = useI18n();
const { keyText, entityLabel, titleText, enumValueText } = useChatText();

const LOOKS_LIKE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ValuePart {
  text: string;
  to?: ReturnType<typeof chatEntityRoute>;
}

const entityKind = computed(() => fieldEntityKind({ field: props.field }));
const displayKind = computed(() => props.field.display?.kind ?? 'text');

/** A list of records longer than this shows its first ones and the count of the rest. */
const NAMED_RECORDS_LIMIT = 5;

const entityParts = ({ value }: { value: unknown }): ValuePart[] => {
  const kind = entityKind.value;
  const ids = Array.isArray(value) ? value : [value];
  const hidden = Math.max(0, ids.length - NAMED_RECORDS_LIMIT);

  const parts = ids.slice(0, NAMED_RECORDS_LIMIT).map((id) => {
    const ref = proposalRefId({ value: id });
    if (ref) {
      const parent = props.dependsOn.find((dependency) => dependency.id === ref);
      return { text: t('chat.cards.fromCard', { title: parent ? titleText({ title: parent.title }) : '…' }) };
    }
    if (!kind) return { text: summarizeValue({ value: id }) };

    const name = props.lookups.entityName({ kind, id: String(id) });
    // A model may offer an alternative by its name; that name reads better than the kind of record.
    const written = typeof id === 'string' && !LOOKS_LIKE_ID.test(id) ? id : null;
    const to = chatEntityRoute({ entity: { kind, id: String(id) } });
    return { text: name ?? written ?? entityLabel({ kind }), ...(to && !(written && !name) ? { to } : {}) };
  });

  return hidden > 0 ? [...parts, { text: t('chat.cards.affected.more', { count: hidden }) }] : parts;
};

const partsOf = ({ value }: { value: unknown }): ValuePart[] => {
  if (value === null || value === undefined || value === '') return [{ text: t('chat.cards.noValue') }];

  if (displayKind.value === 'entity') return entityParts({ value });
  if (displayKind.value === 'boolean' && typeof value === 'boolean') {
    return [{ text: t(value ? 'chat.cards.yes' : 'chat.cards.no') }];
  }
  if (displayKind.value === 'money' && typeof value === 'number') {
    const currencyCode = props.field.display?.currencyCode ?? props.currencyCode;
    return [
      {
        text: formatVisualValue({
          value,
          kind: currencyCode ? 'money' : 'number',
          currencyCode: currencyCode ?? undefined,
        }),
      },
    ];
  }
  if (displayKind.value === 'enum' && typeof value === 'string') {
    return [{ text: enumValueText({ path: props.field.path, value }) }];
  }
  if (displayKind.value === 'enum' && Array.isArray(value)) {
    return [{ text: value.map((item) => enumValueText({ path: props.field.path, value: String(item) })).join(', ') }];
  }
  if (displayKind.value === 'matchingRules') {
    return [
      {
        text: describeMatchingRules({
          value,
          t,
          entityName: props.lookups.entityName,
          enumValue: enumValueText,
        }),
      },
    ];
  }
  if ((displayKind.value === 'date' || displayKind.value === 'datetime') && typeof value === 'string') {
    return [{ text: formatVisualDate({ value }) }];
  }

  return [{ text: summarizeValue({ value }) }];
};

const label = computed(() => keyText({ key: props.field.labelKey }) ?? props.field.path);
const valueParts = computed(() => partsOf({ value: props.field.value }));
const beforeText = computed(() =>
  props.field.before === undefined
    ? null
    : partsOf({ value: props.field.before })
        .map((part) => part.text)
        .join(', '),
);

const uncertainReason = computed<ChatUncertaintyReason | null>(() => props.field.uncertain?.reason ?? null);
const reasonText = computed(() =>
  uncertainReason.value
    ? (keyText({
        key: `chat.cards.uncertainty.${uncertainReason.value}`,
        fallbackKey: 'chat.cards.uncertainty.other',
      }) ?? '')
    : '',
);
const alternatives = computed(() =>
  (props.field.uncertain?.alternatives ?? []).map((value) => ({
    value,
    text: partsOf({ value })
      .map((part) => part.text)
      .join(', '),
  })),
);
</script>

<template>
  <div
    :data-testid="field.uncertain ? 'uncertain' : undefined"
    :class="cn('flex flex-col gap-1 rounded-md px-2 py-1.5', field.uncertain && 'bg-warning/10 ring-warning/30 ring-1')"
  >
    <div class="flex items-baseline justify-between gap-3">
      <dt class="text-muted-foreground shrink-0 text-xs">{{ label }}</dt>
      <dd class="min-w-0 text-right text-sm wrap-anywhere" data-testid="field-value">
        <template v-for="(part, index) in valueParts" :key="index">
          <template v-if="index > 0">, </template>
          <RouterLink v-if="part.to" :to="part.to" class="text-primary-text hover:underline">{{
            part.text
          }}</RouterLink>
          <template v-else>{{ part.text }}</template>
        </template>
      </dd>
    </div>

    <p
      v-if="beforeText !== null"
      class="text-muted-foreground text-right text-xs wrap-anywhere"
      data-testid="field-before"
    >
      {{ $t('chat.cards.fieldBefore', { value: beforeText }) }}
    </p>

    <template v-if="field.uncertain">
      <p class="text-warning-text flex items-center justify-end gap-1.5 text-xs">
        <TriangleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
        {{ reasonText }}
      </p>
      <div v-if="alternatives.length > 0" class="flex flex-wrap items-center justify-end gap-1.5">
        <span class="text-muted-foreground text-xs">{{ $t('chat.cards.uncertain.alternatives') }}</span>
        <Button
          v-for="(alternative, index) in alternatives"
          :key="index"
          type="button"
          variant="outline"
          size="sm"
          data-testid="alternative"
          :disabled="disabled"
          @click="emit('choose', alternative.value)"
        >
          {{ alternative.text }}
        </Button>
      </div>
    </template>
  </div>
</template>
