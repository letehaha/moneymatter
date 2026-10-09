<script setup lang="ts">
import {
  type SubscriptionCandidate,
  acceptSubscriptionCandidate,
  detectSubscriptionCandidates,
  dismissSubscriptionCandidate,
} from '@/api/subscription-candidates';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useInvalidateSubscriptionQueries } from '@/composable/data-queries/subscriptions';
import { captureException } from '@/lib/sentry';
import type { SubscriptionModel } from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useDateLocale } from '@/composable/use-date-locale';
import { SearchIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { QuickAddFormState } from '../quick-add-payload';
import CandidateCard from './candidate-card.vue';
import CandidateTransactionsDialog from './candidate-transactions-dialog.vue';
import QuickAddSubscriptionDialog from './quick-add-subscription-dialog.vue';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const queryClient = useQueryClient();
const invalidateSubscriptionQueries = useInvalidateSubscriptionQueries();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const isCreateDialogOpen = ref(false);
const candidatePrefill = ref<Partial<QuickAddFormState> | null>(null);
// Track which candidate is being accepted so we can mark it after subscription creation
const pendingAcceptCandidateId = ref<string | null>(null);
const linkingId = ref<string | null>(null);
const isTransactionsDialogOpen = ref(false);
const previewTransactionIds = ref<string[]>([]);

const {
  data: detectionResult,
  isLoading,
  isFetching,
} = useQuery({
  queryFn: detectSubscriptionCandidates,
  queryKey: VUE_QUERY_CACHE_KEYS.subscriptionCandidates,
  enabled: computed(() => props.open),
  staleTime: 5 * 60 * 1000,
});

const candidates = computed(() => detectionResult.value?.candidates ?? []);
const activeCandidates = computed(() => candidates.value.filter((c) => !c.isOutdated));
const outdatedCandidates = computed(() => candidates.value.filter((c) => c.isOutdated));
const lastRunAt = computed(() => detectionResult.value?.lastRunAt ?? null);
const isFromCache = computed(() => detectionResult.value?.isFromCache ?? false);

const { formatDistanceToNow } = useDateLocale();

const lastRunLabel = computed(() => {
  if (!lastRunAt.value) return null;
  return formatDistanceToNow(new Date(lastRunAt.value), { addSuffix: true });
});

const { mutate: doDismiss, isPending: isDismissing } = useMutation({
  mutationFn: dismissSubscriptionCandidate,
  onSuccess() {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.subscriptionCandidates });
    addSuccessNotification(t('planned.subscriptions.candidates.dismissed'));
  },
  onError() {
    addErrorNotification(t('planned.subscriptions.candidates.dismissError'));
  },
});

const { mutate: doLink, isPending: isLinking } = useMutation({
  mutationFn: acceptSubscriptionCandidate,
  onSuccess() {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.subscriptionCandidates });
    invalidateSubscriptionQueries();
    addSuccessNotification(t('planned.subscriptions.candidates.linkSuccess'));
    linkingId.value = null;
  },
  onError() {
    addErrorNotification(t('planned.subscriptions.candidates.linkError'));
    linkingId.value = null;
  },
});

// The accept API is deliberately NOT called here: it runs only after the
// subscription is actually created, so a cancelled dialog leaves the candidate open.
const handleAccept = ({ candidate }: { candidate: SubscriptionCandidate }) => {
  pendingAcceptCandidateId.value = candidate.id;
  candidatePrefill.value = {
    name: candidate.suggestedName,
    expectedAmount: candidate.averageAmount,
    expectedCurrencyCode: candidate.currencyCode,
    frequency: candidate.detectedFrequency,
    accountId: candidate.accountId ?? null,
  };
  isCreateDialogOpen.value = true;
};

const handleDismiss = ({ candidate }: { candidate: SubscriptionCandidate }) => {
  doDismiss({ id: candidate.id });
};

const handleViewTransactions = ({ transactionIds }: { transactionIds: string[] }) => {
  previewTransactionIds.value = transactionIds;
  isTransactionsDialogOpen.value = true;
};

const handleLink = ({ candidate }: { candidate: SubscriptionCandidate }) => {
  if (!candidate.possibleMatch) return;
  linkingId.value = candidate.id;
  doLink({ id: candidate.id, subscriptionId: candidate.possibleMatch.id });
};

// Mark the candidate as accepted and link its sample transactions (fire-and-forget:
// the subscription itself was created, so a failed accept is reported but not rolled back).
const handleCreated = ({ subscription }: { subscription: SubscriptionModel }) => {
  const candidateId = pendingAcceptCandidateId.value;
  if (!candidateId) return;
  acceptSubscriptionCandidate({
    id: candidateId,
    subscriptionId: subscription.id,
  })
    .then(() => {
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.subscriptionCandidates });
    })
    .catch((error) => {
      captureException({
        error,
        context: {
          scope: 'discover-candidates-dialog:accept-after-create',
          candidateId,
          subscriptionId: subscription.id,
        },
      });
      addErrorNotification(t('planned.subscriptions.candidates.acceptLinkFailed'));
    });
  pendingAcceptCandidateId.value = null;
};

watch(isCreateDialogOpen, (open) => {
  if (open) return;
  pendingAcceptCandidateId.value = null;
  candidatePrefill.value = null;
});
</script>

<template>
  <ResponsiveDialog
    :open="open"
    dialog-content-class="max-w-lg"
    hide-drawer-footer
    @update:open="emit('update:open', $event)"
  >
    <template #title>{{ t('planned.subscriptions.candidates.title') }}</template>
    <template #description>
      {{ t('planned.subscriptions.candidates.description') }}
    </template>

    <div class="min-h-50">
      <!-- Last scanned indicator -->
      <p v-if="isFromCache && lastRunLabel" class="text-muted-foreground mb-3 text-xs">
        {{ t('planned.subscriptions.candidates.lastScanned', { time: lastRunLabel }) }}
      </p>

      <!-- Loading skeleton -->
      <div v-if="isLoading || isFetching" class="space-y-3">
        <div v-for="i in 3" :key="i" class="border-border bg-card animate-pulse rounded-xl border p-4">
          <div class="flex items-start gap-3">
            <div class="bg-muted size-10 rounded-lg" />
            <div class="flex-1 space-y-2">
              <div class="bg-muted h-4 w-40 rounded" />
              <div class="bg-muted h-3 w-24 rounded" />
            </div>
            <div class="flex flex-col items-end space-y-2">
              <div class="bg-muted h-4 w-20 rounded" />
              <div class="bg-muted h-3 w-14 rounded" />
            </div>
          </div>
          <div class="border-border mt-3 flex items-center justify-between border-t pt-3">
            <div class="bg-muted h-3 w-32 rounded" />
            <div class="flex gap-1.5">
              <div class="bg-muted h-8 w-16 rounded-md" />
              <div class="bg-muted h-8 w-16 rounded-md" />
            </div>
          </div>
        </div>
      </div>

      <!-- Candidates list -->
      <div v-else-if="candidates.length" class="space-y-3">
        <!-- Active candidates -->
        <CandidateCard
          v-for="candidate in activeCandidates"
          :key="candidate.id"
          :candidate="candidate"
          :is-accepting="false"
          :is-dismissing="isDismissing"
          :is-linking="isLinking && linkingId === candidate.id"
          @accept="handleAccept({ candidate: $event })"
          @dismiss="handleDismiss({ candidate: $event })"
          @link="handleLink({ candidate: $event })"
          @view-transactions="handleViewTransactions({ transactionIds: $event })"
        />

        <!-- Outdated candidates section -->
        <template v-if="outdatedCandidates.length">
          <div class="border-border border-t pt-3">
            <p class="text-muted-foreground mb-3 text-xs">
              {{ t('planned.subscriptions.candidates.outdatedWarning') }}
            </p>
            <div class="space-y-3">
              <CandidateCard
                v-for="candidate in outdatedCandidates"
                :key="candidate.id"
                :candidate="candidate"
                :is-accepting="false"
                :is-dismissing="isDismissing"
                :is-linking="isLinking && linkingId === candidate.id"
                @accept="handleAccept({ candidate: $event })"
                @dismiss="handleDismiss({ candidate: $event })"
                @link="handleLink({ candidate: $event })"
                @view-transactions="handleViewTransactions({ transactionIds: $event })"
              />
            </div>
          </div>
        </template>
      </div>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center py-8 text-center">
        <div class="bg-muted mb-3 flex size-12 items-center justify-center rounded-full">
          <SearchIcon class="text-muted-foreground size-6" />
        </div>
        <h4 class="mb-1 font-medium">{{ t('planned.subscriptions.candidates.emptyTitle') }}</h4>
        <p class="text-muted-foreground max-w-xs text-sm">
          {{ t('planned.subscriptions.candidates.emptyDescription') }}
        </p>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t('planned.subscriptions.candidates.close') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>

  <!-- Create subscription dialog (pre-filled from accepted candidate) -->
  <QuickAddSubscriptionDialog
    v-model:open="isCreateDialogOpen"
    :prefill="candidatePrefill"
    @created="handleCreated({ subscription: $event })"
  />

  <!-- Sample transactions preview dialog -->
  <CandidateTransactionsDialog
    :open="isTransactionsDialogOpen"
    :transaction-ids="previewTransactionIds"
    @update:open="isTransactionsDialogOpen = $event"
  />
</template>
