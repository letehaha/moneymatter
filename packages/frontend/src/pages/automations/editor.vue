<script setup lang="ts">
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { Switch } from '@/components/lib/ui/switch';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import {
  useCreateAutomation,
  useTransactionAutomation,
  useUpdateAutomation,
} from '@/composable/data-queries/transaction-automations';
import { extractApiErrorMessage } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes';
import { useTagsStore } from '@/stores';
import {
  type AutomationAction,
  type AutomationConditions,
  type AutomationRefType,
  type RecordId,
} from '@bt/shared/types';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HistoryIcon,
  Loader2Icon,
  PlayIcon,
  WandSparklesIcon,
  ZapIcon,
} from '@lucide/vue';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';

import ActionsBuilder from './components/actions-builder.vue';
import ApplyToHistoryDialog from './components/apply-to-history-dialog.vue';
import AutomationChipTrack from './components/automation-chip-track.vue';
import { buildAutomationChips } from './components/automation-chips';
import { provideAutomationRefs } from './components/automation-refs';
import {
  type AutomationValidationError,
  actionError,
  conditionError,
  nameError,
  trimKeywords,
} from './components/automation-validation';
import { ACTION_DEFAULTS, type AutomationActionDraft, CONDITION_REGISTRY } from './components/condition-registry';
import ConditionsBuilder from './components/conditions-builder.vue';
import PreviewPanel from './components/preview-panel.vue';
import RailSection from './components/rail-section.vue';

const SKELETON_ROW_COUNT = 4;

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

useTagsStore()
  .loadTags()
  .catch((error) => captureException({ error, context: { scope: 'automations-editor:load-tags' } }));

const ruleId = computed(() => (route.params.id as RecordId | undefined) || undefined);
const isCreate = computed(() => !ruleId.value);
const { automation, isFetched, isError } = useTransactionAutomation({ id: ruleId });

const form = reactive({
  name: '',
  isEnabled: true,
  conditions: { match: 'all', items: [CONDITION_REGISTRY.note.defaultValue()] } as AutomationConditions,
  actions: [ACTION_DEFAULTS.set_category()] as AutomationActionDraft[],
});

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const snapshot = ref('');
const isLoaded = ref(false);

watch(
  [isFetched, automation],
  () => {
    if (isLoaded.value) return;
    const rule = automation.value;
    if (!isCreate.value) {
      if (!rule) return;
      form.name = rule.name;
      form.isEnabled = rule.isEnabled;
      form.conditions = clone(rule.conditions);
      form.actions = clone(rule.actions);
    }
    snapshot.value = JSON.stringify(form);
    isLoaded.value = true;
  },
  { immediate: true },
);

const { refVisual, isReady: isRefsReady } = provideAutomationRefs();

const hasMissingRef = ({ type, ids }: { type: AutomationRefType; ids: RecordId[] }) =>
  isRefsReady.value && ids.some((id) => !refVisual({ type, id }));

const translate = (error: AutomationValidationError | null) =>
  error && (error.params ? t(error.key, error.params) : t(error.key));

const formError = computed(() => {
  if (!form.conditions.items.length) return t('automations.editor.errors.conditionsRequired');
  if (!form.actions.length) return t('automations.editor.errors.actionsRequired');
  return null;
});

const formNameError = computed(() => translate(nameError({ name: form.name })));

const conditionErrors = computed(() =>
  form.conditions.items.map((_, index) =>
    translate(conditionError({ items: form.conditions.items, index, hasMissingRef })),
  ),
);
const actionErrors = computed(() => form.actions.map((action) => translate(actionError({ action, hasMissingRef }))));

const matchTabs = computed(() => [
  { value: 'all', label: t('automations.editor.matchAll') },
  { value: 'any', label: t('automations.editor.matchAny') },
]);

const finalizeActions = ({ actions }: { actions: AutomationActionDraft[] }): AutomationAction[] =>
  actions.map((action): AutomationAction => {
    if (action.type === 'set_category') return { ...action, categoryId: action.categoryId! };
    if (action.type === 'set_payee') return { ...action, payeeId: action.payeeId! };
    return action;
  });

/** Live plain-words recap of the rule, built only from the parts that are already valid. */
const sentenceChips = computed(() =>
  buildAutomationChips({
    rule: {
      conditions: {
        match: form.conditions.match,
        items: form.conditions.items.filter(
          (_, index) => !conditionError({ items: form.conditions.items, index, hasMissingRef }),
        ),
      },
      actions: finalizeActions({
        actions: form.actions.filter((action) => !actionError({ action, hasMissingRef })),
      }),
    },
  }),
);
const hasSentence = computed(() => sentenceChips.value.when.length > 0);

const areConditionsValid = computed(
  () => form.conditions.items.length > 0 && conditionErrors.value.every((error) => !error),
);

const isValid = computed(
  () =>
    !formNameError.value && !formError.value && areConditionsValid.value && actionErrors.value.every((error) => !error),
);

const showErrors = ref(false);

const normalizedConditions = computed<AutomationConditions>(() => ({
  match: form.conditions.match,
  items: form.conditions.items.map((item) =>
    item.field === 'note' || item.field === 'merchant' ? { ...item, value: trimKeywords({ value: item.value }) } : item,
  ),
}));

const createMutation = useCreateAutomation();
const updateMutation = useUpdateAutomation();
const isSaving = computed(() => createMutation.isPending.value || updateMutation.isPending.value);

const goToList = () => router.push({ name: ROUTES_NAMES.automations });

const handleSave = () => {
  showErrors.value = true;
  if (!isValid.value || isSaving.value) return;

  const payload = {
    name: form.name.trim(),
    isEnabled: form.isEnabled,
    conditions: normalizedConditions.value,
    actions: finalizeActions({ actions: form.actions }),
  };

  const handlers = {
    onSuccess: () => {
      snapshot.value = JSON.stringify(form);
      addSuccessNotification(t('automations.editor.saveSuccess'));
      goToList();
    },
    onError: (error: unknown) =>
      addErrorNotification(extractApiErrorMessage(error) || t('automations.editor.errors.saveFailed')),
  };

  if (isCreate.value) createMutation.mutate({ payload }, handlers);
  else updateMutation.mutate({ id: ruleId.value!, payload }, handlers);
};

const isDirty = computed(() => isLoaded.value && JSON.stringify(form) !== snapshot.value);
const pendingPath = ref<string | null>(null);
const isLeaveDialogOpen = ref(false);

onBeforeRouteLeave((to) => {
  if (!isDirty.value) return true;
  pendingPath.value = to.fullPath;
  isLeaveDialogOpen.value = true;
  return false;
});

const isApplyOpen = ref(false);

const confirmLeave = () => {
  const path = pendingPath.value;
  pendingPath.value = null;
  snapshot.value = JSON.stringify(form);
  if (path) router.push(path);
};
</script>

<template>
  <div class="flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
    <div class="@container/editor-head flex items-center gap-3">
      <DesktopOnlyTooltip :content="$t('automations.editor.back')">
        <router-link :to="{ name: ROUTES_NAMES.automations }">
          <Button as="span" variant="ghost" size="icon-sm" :aria-label="$t('automations.editor.back')">
            <ArrowLeftIcon class="size-4" />
          </Button>
        </router-link>
      </DesktopOnlyTooltip>
      <h1 class="min-w-0 truncate text-2xl font-bold tracking-tight">
        {{ isCreate ? $t('automations.editor.titleNew') : $t('automations.editor.titleEdit') }}
      </h1>

      <DesktopOnlyTooltip
        v-if="!isCreate && automation"
        :disabled="!isDirty"
        :content="$t('automations.applyToHistory.saveFirst')"
      >
        <span class="ml-auto inline-flex shrink-0">
          <Button
            variant="outline"
            size="sm"
            :disabled="isDirty"
            :aria-label="$t('automations.applyToHistory.trigger')"
            @click="isApplyOpen = true"
          >
            <HistoryIcon class="size-4" />
            <span class="hidden @md/editor-head:inline">{{ $t('automations.applyToHistory.trigger') }}</span>
          </Button>
        </span>
      </DesktopOnlyTooltip>
    </div>

    <Card v-if="!isCreate && !isFetched" class="flex flex-col gap-3 p-4">
      <div v-for="index in SKELETON_ROW_COUNT" :key="index" class="bg-muted h-14 animate-pulse rounded-md" />
    </Card>

    <Card v-else-if="!isCreate && isError && !automation" class="text-destructive-text px-6 py-12 text-center text-sm">
      {{ $t('automations.loadError') }}
    </Card>

    <ResourceNotFound
      v-else-if="!isCreate && !automation"
      :title="$t('automations.editor.notFound.title')"
      :description="$t('automations.editor.notFound.description')"
      :link-label="$t('automations.editor.notFound.link')"
      :link-to="{ name: ROUTES_NAMES.automations }"
    />

    <template v-else>
      <div class="@container/editor flex flex-col gap-5">
        <Card :class="['flex flex-wrap items-end gap-x-5 gap-y-3 p-4', showErrors && formNameError && 'pb-7']">
          <InputField
            v-model="form.name"
            class="w-full min-w-0 @xl/editor:max-w-md @xl/editor:flex-1"
            :label="$t('automations.editor.nameLabel')"
            :placeholder="$t('automations.editor.namePlaceholder')"
            :error-message="showErrors ? (formNameError ?? undefined) : undefined"
            error-placement="absolute"
          />
          <label for="automation-enabled" class="flex h-10 shrink-0 items-center gap-2 text-sm">
            <Switch id="automation-enabled" v-model="form.isEnabled" />
            {{ $t('automations.editor.enabled') }}
          </label>
          <Button type="button" class="ml-auto hidden md:inline-flex" :disabled="isSaving" @click="handleSave">
            <Loader2Icon v-if="isSaving" class="size-4 animate-spin" />
            {{ $t('common.actions.save') }}
          </Button>
        </Card>

        <div
          v-if="hasSentence"
          class="border-border bg-card/50 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-dashed px-3 py-2.5"
        >
          <span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
            {{ $t('automations.chips.when') }}
          </span>
          <AutomationChipTrack
            :chips="sentenceChips.when"
            variant="when"
            density="comfortable"
            :match="form.conditions.match"
          />
          <template v-if="sentenceChips.then.length">
            <ArrowRightIcon class="text-muted-foreground size-3.5 shrink-0" />
            <span class="text-primary-text text-[11px] font-bold tracking-wider uppercase">
              {{ $t('automations.chips.then') }}
            </span>
            <AutomationChipTrack :chips="sentenceChips.then" variant="then" density="comfortable" />
          </template>
        </div>

        <div class="flex flex-col">
          <RailSection :icon="ZapIcon" tone="when" connected>
            <template #header>
              <i18n-t
                keypath="automations.editor.conditionsHeader"
                tag="div"
                class="flex flex-wrap items-center gap-2 text-sm font-semibold"
              >
                <template #match>
                  <PillTabs
                    size="sm"
                    :items="matchTabs"
                    :model-value="form.conditions.match"
                    @update:model-value="(match) => (form.conditions.match = match as 'all' | 'any')"
                  />
                </template>
              </i18n-t>
            </template>
            <ConditionsBuilder v-model="form.conditions" :errors="showErrors ? conditionErrors : []" />
          </RailSection>

          <RailSection :icon="WandSparklesIcon" tone="then" connected>
            <template #header>
              <div class="text-sm font-semibold">{{ $t('automations.editor.actionsHeader') }}</div>
            </template>
            <ActionsBuilder v-model="form.actions" :errors="showErrors ? actionErrors : []" />
          </RailSection>

          <RailSection :icon="PlayIcon" tone="check">
            <template #header>
              <div class="text-sm font-semibold">{{ $t('automations.editor.preview.title') }}</div>
            </template>
            <PreviewPanel :conditions="normalizedConditions" :disabled="!areConditionsValid" />
          </RailSection>
        </div>

        <p v-if="showErrors && formError" class="text-destructive-text text-xs">{{ formError }}</p>
      </div>

      <div class="bg-background/95 border-border sticky bottom-0 z-10 -mx-4 border-t px-4 py-3 backdrop-blur md:hidden">
        <Button type="button" class="w-full" :disabled="isSaving" @click="handleSave">
          <Loader2Icon v-if="isSaving" class="size-4 animate-spin" />
          {{ $t('common.actions.save') }}
        </Button>
      </div>
    </template>

    <ApplyToHistoryDialog v-if="isApplyOpen" v-model:open="isApplyOpen" :rule="automation" />

    <ResponsiveAlertDialog
      v-model:open="isLeaveDialogOpen"
      :confirm-label="$t('automations.editor.unsaved.confirm')"
      confirm-variant="destructive"
      @confirm="confirmLeave"
    >
      <template #title>{{ $t('automations.editor.unsaved.title') }}</template>
      <template #description>{{ $t('automations.editor.unsaved.description') }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>
