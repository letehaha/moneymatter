<script setup lang="ts">
import { formatShortDate } from '@/common/utils/date';
import { getErrorMessage } from '@/common/utils/error-message';
import { formatFractionAsPercent } from '@/common/utils/percentage';
import EditableEntityLogo from '@/components/common/editable-entity-logo.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import VentureDealLogo from '@/components/common/venture-deal-logo.vue';
import VentureDealForm from '@/components/forms/venture-deal-form.vue';
import VentureEventForm from '@/components/forms/venture-event-form.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useFormatCurrency } from '@/composable/formatters';
import { useDeleteVentureDeal, useUpdateVentureDeal, useVentureDeal } from '@/composable/data-queries/venture/deals';
import DealStatusPill from '@/pages/venture/components/deal-status-pill.vue';
import EventsTimeline from '@/pages/venture/components/events-timeline.vue';
import MetricsSummary from '@/pages/venture/components/metrics-summary.vue';
import { ROUTES_NAMES } from '@/routes';
import type { NonImageLogoPayload } from '@bt/shared/types';
import { ArrowLeftIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const dealId = computed(() => (route.params.dealId as string) ?? '');
const { data: deal, isPending } = useVentureDeal(dealId);

const editOpen = ref(false);
const deleteOpen = ref(false);
const createEventOpen = ref(false);

const deleteMutation = useDeleteVentureDeal();
const updateMutation = useUpdateVentureDeal();

const saveLogo = ({ payload }: { payload: NonImageLogoPayload }) =>
  updateMutation.mutateAsync({ dealId: dealId.value, payload });

const onEditSaved = () => {
  editOpen.value = false;
};

const onDelete = async () => {
  if (!deal.value) return;
  try {
    await deleteMutation.mutateAsync(deal.value.id);
    addNotification({
      text: t('venture.deals.notifications.deleted'),
      type: NotificationType.success,
    });
    deleteOpen.value = false;
    router.push({ name: ROUTES_NAMES.venture });
  } catch (err) {
    addNotification({
      text: getErrorMessage(err, t('venture.deals.notifications.error')),
      type: NotificationType.error,
    });
  }
};
</script>

<template>
  <div class="@container/venture-deal mx-auto w-full p-4 md:p-6">
    <div class="mb-6">
      <router-link
        :to="{ name: ROUTES_NAMES.venture }"
        class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ArrowLeftIcon class="size-4" />
        <span>{{ $t('venture.deals.backToDeals') }}</span>
      </router-link>
    </div>

    <div v-if="isPending" class="bg-muted h-40 w-full animate-pulse rounded-md" />

    <div v-else-if="deal" class="grid gap-8">
      <header class="border-border/60 flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div class="flex min-w-0 items-start gap-4">
          <EditableEntityLogo :entity="deal" flow="ventureDealLogo" :save="saveLogo" class="size-12">
            <VentureDealLogo :deal="deal" class="size-full" />
          </EditableEntityLogo>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <DealStatusPill :status="deal.status" show-dot />
              <span v-if="deal.platform" class="text-muted-foreground text-xs">
                {{ deal.platform.name }}
              </span>
            </div>
            <h1 class="mt-2 text-3xl leading-tight font-medium @md/venture-deal:text-4xl">
              {{ deal.name }}
            </h1>
            <p v-if="deal.targetCompany" class="text-muted-foreground mt-1 text-sm">
              {{ deal.targetCompany }}
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <UiButton variant="secondary" @click="editOpen = true">
            <PencilIcon class="size-4" />
            <span>{{ $t('venture.deals.edit') }}</span>
          </UiButton>
          <UiButton variant="ghost-destructive" @click="deleteOpen = true">
            <Trash2Icon class="size-4" />
            <span>{{ $t('venture.deals.delete') }}</span>
          </UiButton>
        </div>
      </header>

      <section>
        <div class="text-muted-foreground mb-3 text-[10px] font-medium tracking-[0.12em] uppercase">
          {{ $t('venture.deals.dealTerms') }}
        </div>
        <div
          class="bg-card border-border grid grid-cols-2 gap-x-6 gap-y-5 rounded-xl border p-5 @md/venture-deal:grid-cols-4"
        >
          <div>
            <div class="text-muted-foreground text-xs">{{ $t('venture.deals.principal') }}</div>
            <div class="mt-0.5 text-xl font-medium tabular-nums">
              {{ formatAmountByCurrencyCode(Number(deal.principal), deal.currencyCode) }}
            </div>
          </div>
          <div>
            <div class="text-muted-foreground text-xs">{{ $t('venture.deals.entryFee') }}</div>
            <div class="mt-0.5 text-xl font-medium tabular-nums">
              {{ formatAmountByCurrencyCode(Number(deal.entryFee), deal.currencyCode) }}
            </div>
          </div>
          <div>
            <div class="text-muted-foreground text-xs">{{ $t('venture.deals.carry') }}</div>
            <div class="mt-0.5 text-xl font-medium tabular-nums">{{ formatFractionAsPercent(deal.carryPct) }}</div>
          </div>
          <div>
            <div class="text-muted-foreground text-xs">{{ $t('venture.deals.hurdle') }}</div>
            <div class="mt-0.5 text-xl font-medium tabular-nums">{{ formatFractionAsPercent(deal.hurdlePct) }}</div>
          </div>
          <div>
            <div class="text-muted-foreground text-xs">{{ $t('venture.deals.investmentDate') }}</div>
            <div class="mt-0.5 text-sm">{{ formatShortDate(deal.investmentDate) }}</div>
          </div>
          <div v-if="deal.expectedExitDate">
            <div class="text-muted-foreground text-xs">{{ $t('venture.deals.expectedExitDate') }}</div>
            <div class="mt-0.5 text-sm">{{ formatShortDate(deal.expectedExitDate) }}</div>
          </div>
        </div>
      </section>

      <section>
        <div class="text-muted-foreground mb-3 text-[10px] font-medium tracking-[0.12em] uppercase">
          {{ $t('venture.metrics.performance') }}
        </div>
        <MetricsSummary :deal-id="deal.id" :currency-code="deal.currencyCode" />
      </section>

      <section v-if="deal.notes">
        <div class="text-muted-foreground mb-3 text-[10px] font-medium tracking-[0.12em] uppercase">
          {{ $t('venture.deals.notes') }}
        </div>
        <div class="bg-card border-border rounded-xl border p-5">
          <p class="text-sm whitespace-pre-wrap">{{ deal.notes }}</p>
        </div>
      </section>

      <section>
        <div class="mb-3 flex items-end justify-between">
          <div class="text-muted-foreground text-[10px] font-medium tracking-[0.12em] uppercase">
            {{ $t('venture.events.timelineTitle') }}
          </div>
          <UiButton size="sm" variant="secondary" @click="createEventOpen = true">
            <PlusIcon class="size-4" />
            <span>{{ $t('venture.events.addEvent') }}</span>
          </UiButton>
        </div>
        <EventsTimeline :deal-id="deal.id" :currency-code="deal.currencyCode" />
      </section>
    </div>

    <ResponsiveDialog v-model:open="editOpen" :hide-drawer-footer="true">
      <template #title>{{ $t('venture.deals.editDialogTitle') }}</template>
      <template #description>{{ $t('venture.deals.editDialogDescription') }}</template>
      <VentureDealForm v-if="deal" :deal="deal" @saved="onEditSaved" @cancel="editOpen = false" />
    </ResponsiveDialog>

    <ResponsiveAlertDialog
      v-model:open="deleteOpen"
      :confirm-label="$t('venture.deals.deleteConfirm')"
      confirm-variant="destructive"
      @confirm="onDelete"
    >
      <template #title>{{ $t('venture.deals.deleteTitle') }}</template>
      <template #description>{{ $t('venture.deals.deleteDescription', { name: deal?.name ?? '' }) }}</template>
    </ResponsiveAlertDialog>

    <ResponsiveDialog v-model:open="createEventOpen" :hide-drawer-footer="true">
      <template #title>{{ $t('venture.events.createDialogTitle') }}</template>
      <template #description>{{ $t('venture.events.createDialogDescription') }}</template>
      <VentureEventForm v-if="deal" :deal="deal" @saved="createEventOpen = false" @cancel="createEventOpen = false" />
    </ResponsiveDialog>
  </div>
</template>
