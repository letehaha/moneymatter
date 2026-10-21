<script setup lang="ts">
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import {
  CHAT_CLARIFICATION_LIMITS,
  type ChatClarificationAnswerInput,
  type ChatClarificationPart,
} from '@bt/shared/types';
import { computed, ref } from 'vue';

const props = defineProps<{
  part: ChatClarificationPart;
  /** The parent is sending an answer; the card stays locked until the thread shows it. */
  disabled?: boolean;
}>();

const emit = defineEmits<{ answer: [answer: ChatClarificationAnswerInput] }>();

const selected = ref<string[]>([]);
const freeText = ref('');

const isAnswered = computed(() => props.part.answer !== undefined);
const isLocked = computed(() => isAnswered.value || props.disabled === true);
const shownIds = computed(() => props.part.answer?.optionIds ?? selected.value);
const trimmedText = computed(() => freeText.value.trim());
const canSend = computed(() => !isLocked.value && (selected.value.length > 0 || trimmedText.value !== ''));

const toggle = ({ id }: { id: string }) => {
  if (isLocked.value) return;

  if (!props.part.multiSelect) {
    selected.value = [id];
    return;
  }
  selected.value = selected.value.includes(id) ? selected.value.filter((item) => item !== id) : [...selected.value, id];
};

const send = () => {
  if (!canSend.value) return;

  emit('answer', {
    clarificationId: props.part.id,
    optionIds: selected.value,
    ...(props.part.allowFreeText && trimmedText.value !== '' ? { freeText: trimmedText.value } : {}),
  });
};
</script>

<template>
  <section class="bg-card flex min-w-0 flex-col gap-3 rounded-xl border p-4" data-testid="clarification-card">
    <p class="text-sm font-medium wrap-anywhere">{{ part.question }}</p>
    <p v-if="!isAnswered" class="text-muted-foreground text-xs">
      {{ part.multiSelect ? $t('chat.clarification.chooseMany') : $t('chat.clarification.chooseOne') }}
    </p>

    <div class="flex flex-wrap gap-2">
      <Button
        v-for="option in part.options"
        :key="option.id"
        type="button"
        size="sm"
        :variant="shownIds.includes(option.id) ? 'soft-primary' : 'outline'"
        :aria-pressed="shownIds.includes(option.id)"
        :data-testid="`option-${option.id}`"
        :disabled="isLocked"
        @click="toggle({ id: option.id })"
      >
        {{ option.label }}
      </Button>
    </div>

    <div v-if="part.allowFreeText && !isAnswered" data-testid="free-text">
      <TextareaField
        v-model="freeText"
        :label="$t('chat.clarification.freeText')"
        :placeholder="$t('chat.clarification.freeTextPlaceholder')"
        :maxlength="CHAT_CLARIFICATION_LIMITS.freeTextMaxChars"
        :disabled="isLocked"
      />
    </div>

    <p v-if="isAnswered" class="text-muted-foreground text-sm wrap-anywhere">
      {{ $t('chat.clarification.answered')
      }}<template v-if="part.answer?.freeText">: {{ part.answer.freeText }}</template>
    </p>
    <div v-else class="flex justify-end">
      <Button type="button" size="sm" data-testid="send-answer" :disabled="!canSend" @click="send">
        {{ $t('chat.clarification.send') }}
      </Button>
    </div>
  </section>
</template>
