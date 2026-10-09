<template>
  <Collapsible v-if="shouldRender" v-model:open="isOpen" class="mt-10">
    <CollapsibleTrigger
      class="hover:bg-accent/40 group bg-card/40 flex w-full items-center justify-between gap-3 rounded-md border border-dashed px-4 py-3 transition-colors"
    >
      <div class="flex items-center gap-2">
        <Trash2Icon class="text-muted-foreground size-4" />
        <h2 class="text-foreground text-base font-semibold tracking-tight">
          {{ $t('investments.trash.title') }}
        </h2>
        <span
          v-if="trashedPortfolios.length"
          class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium"
        >
          {{ trashedPortfolios.length }}
        </span>
        <span class="text-muted-foreground text-xs">
          {{ $t('investments.trash.retentionHint', { days: PORTFOLIO_TRASH_RETENTION_DAYS }) }}
        </span>
      </div>
      <ChevronDownIcon
        :class="cn('text-muted-foreground size-4 transition-transform duration-200', isOpen && 'rotate-180')"
      />
    </CollapsibleTrigger>

    <CollapsibleContent class="mt-3">
      <!-- Loading: skeleton cards (matches the live-list pattern in investments.vue). -->
      <div v-if="isLoading" class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        <Card v-for="i in 2" :key="i" class="border-dashed">
          <CardHeader class="p-4 pb-2">
            <div class="space-y-1.5">
              <div class="bg-muted h-5 w-32 animate-pulse rounded" />
              <div class="bg-muted h-3 w-20 animate-pulse rounded" />
            </div>
          </CardHeader>
          <CardContent class="flex gap-2 p-4 pt-1">
            <div class="bg-muted h-8 flex-1 animate-pulse rounded" />
            <div class="bg-muted h-8 flex-1 animate-pulse rounded" />
          </CardContent>
        </Card>
      </div>

      <!-- Error: surface a retry instead of silently hiding the section. -->
      <div v-else-if="isError" class="bg-card/40 rounded-md border border-dashed p-6 text-center">
        <p class="text-destructive-text mb-3 text-sm">{{ $t('investments.trash.loadError') }}</p>
        <UiButton size="sm" variant="outline" @click="refetch()">
          {{ $t('investments.trash.tryAgain') }}
        </UiButton>
      </div>

      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        <Card
          v-for="portfolio in trashedPortfolios"
          :key="portfolio.id"
          class="border-dashed opacity-80 transition-all duration-200 hover:opacity-100"
        >
          <CardHeader class="p-4 pb-2">
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-base leading-tight font-semibold tracking-tight">
                {{ portfolio.name }}
              </h3>
              <p class="text-muted-foreground mt-0.5 text-xs">
                {{ $t('investments.trash.deletedAgo', { time: formatDeletedAt(portfolio.deletedAt) }) }}
              </p>
            </div>
          </CardHeader>
          <CardContent class="flex items-center gap-2 p-4 pt-1">
            <UiButton
              variant="secondary"
              size="sm"
              class="flex-1"
              :disabled="isRowBusy(portfolio.id)"
              @click="onRestore(portfolio.id)"
            >
              <Undo2Icon class="mr-2 size-4" />
              {{
                pendingAction === 'restore' && pendingId === portfolio.id
                  ? $t('investments.trash.restoringButton')
                  : $t('investments.trash.restoreButton')
              }}
            </UiButton>
            <UiButton
              variant="destructive"
              size="sm"
              class="flex-1"
              :disabled="isRowBusy(portfolio.id)"
              @click="openPurgeConfirm(portfolio)"
            >
              <Trash2Icon class="mr-2 size-4" />
              {{
                pendingAction === 'purge' && pendingId === portfolio.id
                  ? $t('investments.trash.purgingButton')
                  : $t('investments.trash.purgeButton')
              }}
            </UiButton>
          </CardContent>
        </Card>
      </div>
    </CollapsibleContent>
  </Collapsible>

  <ResponsiveAlertDialog
    v-model:open="isPurgeConfirmOpen"
    :confirm-label="$t('investments.trash.purgeButton')"
    confirm-variant="destructive"
    :confirm-disabled="purgeMutation.isPending.value"
    @confirm="confirmPurge"
  >
    <template #title>{{ $t('investments.trash.confirmPurgeTitle') }}</template>
    <template #description>
      {{ $t('investments.trash.confirmPurge', { name: purgeCandidate?.name ?? '' }) }}
    </template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { useNotificationCenter } from '@/components/notification-center';
import {
  useDeletedPortfolios,
  usePermanentlyDeletePortfolio,
  useRestorePortfolio,
} from '@/composable/data-queries/portfolios';
import { ApiErrorResponseError } from '@/js/errors';
import { cn } from '@/lib/utils';
import { PORTFOLIO_TRASH_RETENTION_DAYS } from '@bt/shared/types/investments';
import { useDateLocale } from '@/composable/use-date-locale';
import { ChevronDownIcon, Trash2Icon, Undo2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const { data, isLoading, isError, refetch } = useDeletedPortfolios();
const restoreMutation = useRestorePortfolio();
const purgeMutation = usePermanentlyDeletePortfolio();

const trashedPortfolios = computed(() => data.value ?? []);
// Render the panel whenever there's something to show OR an error/loading state
// to communicate — silently hiding on error would mask broken state for users
// who actually have trashed portfolios.
const shouldRender = computed(() => trashedPortfolios.value.length > 0 || isLoading.value || isError.value);

const pendingId = ref<string | null>(null);
const pendingAction = ref<'restore' | 'purge' | null>(null);
const isOpen = ref(false);

const purgeCandidate = ref<{ id: string; name: string } | null>(null);
const isPurgeConfirmOpen = ref(false);

const isRowBusy = (id: string) =>
  (restoreMutation.isPending.value || purgeMutation.isPending.value) && pendingId.value === id;

const { formatDistanceToNow } = useDateLocale();

const formatDeletedAt = (deletedAt: Date | string | null) => {
  if (!deletedAt) return '';
  return formatDistanceToNow(new Date(deletedAt), { addSuffix: true });
};

const reportError = (e: unknown, fallbackKey: string) => {
  const message = e instanceof ApiErrorResponseError && e.data?.message ? e.data.message : t(fallbackKey);
  addErrorNotification(message);
};

const onRestore = async (id: string) => {
  pendingId.value = id;
  pendingAction.value = 'restore';
  try {
    await restoreMutation.mutateAsync(id);
    addSuccessNotification(t('investments.trash.notifications.restored'));
  } catch (e) {
    reportError(e, 'investments.trash.notifications.restoreError');
  } finally {
    pendingId.value = null;
    pendingAction.value = null;
  }
};

const openPurgeConfirm = (portfolio: { id: string; name: string }) => {
  purgeCandidate.value = { id: portfolio.id, name: portfolio.name };
  isPurgeConfirmOpen.value = true;
};

const confirmPurge = async () => {
  const candidate = purgeCandidate.value;
  if (!candidate) return;
  pendingId.value = candidate.id;
  pendingAction.value = 'purge';
  try {
    await purgeMutation.mutateAsync(candidate.id);
    addSuccessNotification(t('investments.trash.notifications.purged'));
    isPurgeConfirmOpen.value = false;
    purgeCandidate.value = null;
  } catch (e) {
    reportError(e, 'investments.trash.notifications.purgeError');
  } finally {
    pendingId.value = null;
    pendingAction.value = null;
  }
};
</script>
