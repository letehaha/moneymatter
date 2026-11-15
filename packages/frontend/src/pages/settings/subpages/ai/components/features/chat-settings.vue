<script setup lang="ts">
import SelectField from '@/components/fields/select-field.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useUpdateChatSettings } from '@/composable/data-queries/chat';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { ROUTES_NAMES } from '@/routes/constants';
import { CHAT_DEFAULT_RETENTION_DAYS, CHAT_RETENTION_OPTIONS, type ChatRetentionDays } from '@bt/shared/types';
import { ChevronRightIcon, HistoryIcon, MessageSquareIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface RetentionOption {
  value: string;
  label: string;
  retentionDays: ChatRetentionDays | null;
}

const NEVER_VALUE = 'never';

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const { data: userSettings } = useUserSettings();
const updateSettings = useUpdateChatSettings();

const options = computed<RetentionOption[]>(() => [
  ...CHAT_RETENTION_OPTIONS.map((days) => ({
    value: String(days),
    label: t(`settings.ai.chat.retention.options.days${days}`),
    retentionDays: days,
  })),
  { value: NEVER_VALUE, label: t('settings.ai.chat.retention.options.never'), retentionDays: null },
]);

/** Someone who never chose has no stored value; `null` is a choice ("never"). */
const retentionDays = computed<ChatRetentionDays | null>(() => {
  const stored = userSettings.value?.ai?.chat?.retentionDays;
  return stored === undefined ? CHAT_DEFAULT_RETENTION_DAYS : stored;
});

const selected = computed(() => options.value.find((option) => option.retentionDays === retentionDays.value) ?? null);

const onChange = async (option: RetentionOption | null) => {
  if (!option || option.retentionDays === retentionDays.value) return;

  try {
    await updateSettings.mutateAsync({ retentionDays: option.retentionDays });
    addSuccessNotification(t('settings.ai.chat.retention.saved'));
  } catch {
    // The mutation reports the failure.
  }
};
</script>

<template>
  <section class="rounded-lg border p-4">
    <div class="mb-4 flex items-center gap-2">
      <MessageSquareIcon class="text-muted-foreground size-4" aria-hidden="true" />
      <div>
        <h4 class="font-medium">{{ $t('settings.ai.chat.title') }}</h4>
        <p class="text-muted-foreground text-sm">{{ $t('settings.ai.chat.description') }}</p>
      </div>
    </div>

    <div class="mb-2 flex items-center gap-2">
      <HistoryIcon class="text-muted-foreground size-4" aria-hidden="true" />
      <h5 class="text-sm font-medium">{{ $t('settings.ai.chat.retention.title') }}</h5>
    </div>

    <p class="text-muted-foreground mb-3 text-xs leading-relaxed">
      {{ $t('settings.ai.chat.retention.description') }}
    </p>

    <SelectField
      class="max-w-xs"
      :label="$t('settings.ai.chat.retention.label')"
      :model-value="selected"
      :values="options"
      :placeholder="$t('settings.ai.chat.retention.placeholder')"
      :disabled="updateSettings.isPending.value"
      @update:model-value="onChange"
    />

    <p class="text-muted-foreground mt-2 text-xs leading-relaxed">{{ $t('settings.ai.chat.retention.pinnedNote') }}</p>

    <RouterLink
      :to="{ name: ROUTES_NAMES.settingsAiChatApplied }"
      class="hover:bg-muted/50 mt-4 flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors"
    >
      <span class="flex flex-col">
        <span class="text-sm font-medium">{{ $t('settings.ai.chat.applied.link') }}</span>
        <span class="text-muted-foreground text-xs">{{ $t('settings.ai.chat.applied.linkDescription') }}</span>
      </span>
      <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
    </RouterLink>
  </section>
</template>
