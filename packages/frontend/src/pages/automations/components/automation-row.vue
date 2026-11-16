<script setup lang="ts">
import ResponsiveMenu from '@/components/common/responsive-menu.vue';
import { Button } from '@/components/lib/ui/button';
import { Switch } from '@/components/lib/ui/switch';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useUpdateAutomation } from '@/composable/data-queries/transaction-automations';
import { isApiErrorWithCode } from '@/js/errors';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { API_ERROR_CODES, type TransactionAutomationModel } from '@bt/shared/types';
import { ArrowRightIcon, GripVerticalIcon, HistoryIcon, MoreVerticalIcon, PencilIcon, Trash2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { format } from 'date-fns';

import AutomationChipTrack from './automation-chip-track.vue';
import { type AutomationDensity, buildAutomationChips } from './automation-chips';

const props = defineProps<{
  rule: TransactionAutomationModel;
  /** 1-based priority; omitted when the list is filtered and the index no longer means priority. */
  position?: number;
  density: AutomationDensity;
  reorderable: boolean;
  selectable?: boolean;
}>();
const emit = defineEmits<{ delete: []; apply: []; select: [] }>();

const { t } = useI18n();
const router = useRouter();
const { addErrorNotification, addNotification } = useNotificationCenter();

const isMenuOpen = ref(false);

const chips = computed(() => buildAutomationChips({ rule: props.rule }));

const matchStats = computed(() =>
  props.rule.lastMatchedAt
    ? t('automations.matchStats', {
        count: props.rule.matchCount,
        date: format(new Date(props.rule.lastMatchedAt), 'd MMM yyyy'),
      })
    : t('automations.matchStatsNever'),
);

const pausedLabel = computed(() => {
  const reason = props.rule.pausedReason;
  if (!reason) return t('automations.disabledPill');

  const refType = t(`automations.refType.${reason.refType}`);
  return reason.label
    ? t('automations.pausedMissingRef', { refType, label: reason.label })
    : t('automations.pausedMissingRefUnnamed', { refType });
});

const bodyClass = computed(() => cn('min-w-0 flex-1', !props.rule.isEnabled && 'opacity-55'));

const eyebrowClass = 'text-[10px] font-extrabold tracking-wider uppercase @md/automations:hidden';

// Below @md each group is a stacked, bordered panel with its eyebrow as a header; at @md and in
// compact density the groups collapse back into a single inline row.
const groupClass = computed(() =>
  cn(
    'flex min-w-0 items-center gap-1.5',
    props.density === 'comfortable' &&
      'border-border bg-muted/30 flex-col items-start rounded-lg border border-dashed p-2 @md/automations:border-0 @md/automations:bg-transparent @md/automations:p-0 @md/automations:flex-row @md/automations:items-center',
  ),
);

const openEditor = () =>
  router.push({
    name: ROUTES_NAMES.automationDetails,
    params: { id: props.rule.id },
  });

const updateMutation = useUpdateAutomation();

const toggleEnabled = (isEnabled: boolean) => {
  updateMutation.mutate(
    { id: props.rule.id, payload: { isEnabled } },
    {
      onError: (error) => {
        if (isApiErrorWithCode(error, API_ERROR_CODES.validationError)) {
          addNotification({
            text: t('automations.notifications.staleReference'),
            type: NotificationType.error,
            action: {
              label: t('automations.notifications.openRule'),
              onClick: () => openEditor(),
            },
          });
          return;
        }
        addErrorNotification(t('automations.notifications.toggleError'));
      },
    },
  );
};

const activate = () => (props.selectable ? emit('select') : openEditor());

const handleMenuAction = ({ close, action }: { close: () => void; action: 'edit' | 'apply' | 'delete' }) => {
  close();
  if (action === 'edit') openEditor();
  else if (action === 'apply') emit('apply');
  else emit('delete');
};
</script>

<template>
  <div
    class="hover:bg-hover flex cursor-pointer items-stretch gap-2 px-3 transition-colors @md/automations:gap-3"
    :class="density === 'compact' ? 'py-1.5' : 'py-3'"
    role="button"
    tabindex="0"
    @click="activate"
    @keydown.enter.self="activate"
    @keydown.space.self.prevent="activate"
  >
    <div class="-ml-3 flex w-8 shrink-0 flex-col self-stretch" :class="density === 'compact' ? '-my-1.5' : '-my-3'">
      <span
        class="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-br-md text-sm font-semibold tabular-nums"
        :class="{ 'opacity-55': !rule.isEnabled }"
      >
        {{ position ?? '·' }}
      </span>
      <DesktopOnlyTooltip
        v-if="!selectable"
        :content="reorderable ? $t('automations.dragHint') : $t('automations.reorderDisabledFiltered')"
      >
        <span
          class="drag-handle text-muted-foreground flex min-h-6 flex-1 items-center justify-center"
          :class="reorderable ? 'hover:text-foreground hover:bg-hover cursor-grab' : 'cursor-not-allowed opacity-50'"
          @click.stop
        >
          <GripVerticalIcon class="size-4" />
        </span>
      </DesktopOnlyTooltip>
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2 @md/automations:gap-3">
        <div :class="bodyClass">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 @md/automations:flex-nowrap">
            <span class="truncate text-base font-medium">{{ rule.name }}</span>

            <span
              v-if="!rule.isEnabled"
              class="bg-warning-text/10 text-warning-text order-2 rounded-full px-2 py-0.5 text-xs @md/automations:order-1"
            >
              {{ pausedLabel }}
            </span>

            <span
              class="text-muted-foreground order-1 basis-full text-xs @md/automations:order-2 @md/automations:basis-auto @md/automations:whitespace-nowrap"
            >
              {{ matchStats }}
            </span>
          </div>
        </div>

        <Switch
          v-if="!selectable"
          class="mt-0.5 shrink-0"
          :model-value="rule.isEnabled"
          :aria-label="$t('automations.toggleAriaLabel')"
          @click.stop
          @update:model-value="toggleEnabled"
        />

        <div v-if="!selectable" @click.stop>
          <DesktopOnlyTooltip :content="$t('automations.menuAriaLabel')">
            <span class="inline-flex">
              <ResponsiveMenu v-model:open="isMenuOpen">
                <template #trigger>
                  <Button variant="ghost" size="icon-sm" class="shrink-0" :aria-label="$t('automations.menuAriaLabel')">
                    <MoreVerticalIcon class="size-4" />
                  </Button>
                </template>

                <template #default="{ close }">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="w-full justify-start gap-2"
                    @click="handleMenuAction({ close, action: 'edit' })"
                  >
                    <PencilIcon class="size-4" />
                    {{ $t('common.actions.edit') }}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="w-full justify-start gap-2"
                    @click="handleMenuAction({ close, action: 'apply' })"
                  >
                    <HistoryIcon class="size-4" />
                    {{ $t('automations.applyToHistory.trigger') }}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-destructive-text hover:text-destructive-text w-full justify-start gap-2"
                    @click="handleMenuAction({ close, action: 'delete' })"
                  >
                    <Trash2Icon class="size-4" />
                    {{ $t('common.actions.delete') }}
                  </Button>
                </template>
              </ResponsiveMenu>
            </span>
          </DesktopOnlyTooltip>
        </div>
      </div>

      <div
        class="mt-1 flex flex-col gap-1 @md/automations:mt-1.5 @md/automations:flex-row @md/automations:items-center @md/automations:gap-1.5"
        :class="[density === 'compact' && 'flex-row items-center', !rule.isEnabled && 'opacity-55']"
      >
        <div v-if="chips.when.length" :class="groupClass">
          <span :class="[eyebrowClass, 'text-muted-foreground', density === 'compact' && 'hidden']">
            {{ $t('automations.chips.when') }}
          </span>
          <AutomationChipTrack :chips="chips.when" :match="chips.match" :density="density" variant="when" />
        </div>

        <ArrowRightIcon
          v-if="chips.when.length && chips.then.length"
          class="text-muted-foreground hidden size-3.5 shrink-0 @md/automations:block"
        />

        <div v-if="chips.then.length" :class="groupClass">
          <span :class="[eyebrowClass, 'text-primary-text', density === 'compact' && 'hidden']">
            {{ $t('automations.chips.then') }}
          </span>
          <AutomationChipTrack :chips="chips.then" :density="density" variant="then" />
        </div>
      </div>
    </div>
  </div>
</template>
