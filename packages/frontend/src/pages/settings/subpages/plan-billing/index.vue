<template>
  <Card class="@container/plan-billing max-w-4xl">
    <CardHeader class="border-b">
      <h2 class="mb-2 text-2xl font-semibold">
        {{ $t('settings.planBilling.title') }}
      </h2>
      <p class="text-sm opacity-80">
        {{ $t('settings.planBilling.description') }}
      </p>
    </CardHeader>

    <CardContent class="mt-6 space-y-6">
      <section
        v-if="view.status"
        :class="
          cn(
            'grid gap-3.5 rounded-lg border p-5',
            view.status.tone === 'info' && 'border-primary/45 bg-primary/5',
            view.status.tone === 'warning' && 'border-warning-text/45 bg-warning-text/5',
            view.status.tone === 'destructive' && 'border-destructive-text/45 bg-destructive-text/5',
          )
        "
        aria-live="polite"
      >
        <div class="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
          <div class="grid min-w-0 flex-1 gap-1.5">
            <span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
              {{ $t('settings.planBilling.currentPlanEyebrow') }}
            </span>
            <div class="flex flex-wrap items-center gap-2.5 text-lg font-bold tracking-tight">
              <span>{{ view.status.title }}</span>
              <StatusBadge v-if="view.status.badge" :variant="view.status.badge.variant">
                {{ view.status.badge.label }}
              </StatusBadge>
            </div>
            <div v-if="view.status.meta.length" class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span v-for="item in view.status.meta" :key="item">{{ item }}</span>
            </div>
          </div>

          <div
            v-if="view.hasAppStoreSubscription || view.hasStripeSubscription"
            class="flex flex-wrap items-center gap-2"
          >
            <Button
              v-if="view.hasAppStoreSubscription"
              size="sm"
              variant="outline"
              as="a"
              :href="EXTERNAL_URLS.appStoreSubscriptions"
              target="_blank"
              rel="noopener"
            >
              {{ $t('settings.planBilling.manageInAppStore') }}
            </Button>
            <Button
              v-if="view.hasStripeSubscription"
              size="sm"
              :variant="view.status.tone === 'destructive' ? 'default' : 'outline'"
              :disabled="opening !== null"
              @click="openPortal()"
            >
              <LoaderCircleIcon v-if="opening === 'portal'" class="size-4 animate-spin" />
              {{
                view.status.tone === 'destructive'
                  ? $t('settings.planBilling.updatePaymentMethod')
                  : $t('settings.planBilling.manageBilling')
              }}
            </Button>
          </div>
        </div>

        <div v-if="view.trialProgress">
          <div class="bg-muted-foreground/20 h-1.5 overflow-hidden rounded-full">
            <div
              :class="cn('h-full rounded-full', view.trialProgress.urgent ? 'bg-warning-text' : 'bg-primary')"
              :style="{ width: `${view.trialProgress.percent}%` }"
            />
          </div>
          <div class="text-muted-foreground mt-1.5 flex justify-between text-xs tabular-nums">
            <span>
              {{
                $t('settings.planBilling.current.trialProgress', {
                  used: view.trialProgress.used,
                  total: view.trialProgress.total,
                })
              }}
            </span>
            <span>{{ $t('settings.planBilling.current.trial', view.trialProgress.left) }}</span>
          </div>
        </div>

        <p
          v-if="view.status.note || showReadOnlyHelp"
          :class="
            cn(
              'text-sm',
              view.status.tone === 'destructive' ? 'text-destructive-text' : 'text-muted-foreground',
              view.status.tone === 'warning' && 'text-warning-text',
            )
          "
        >
          {{ view.status.note }}
          <DocsLink v-if="showReadOnlyHelp" path="/settings/plans-and-billing/#read-only-mode">
            {{ $t('settings.planBilling.current.readOnlyHelp') }}
          </DocsLink>
        </p>
      </section>

      <div class="flex flex-wrap items-center justify-between gap-2.5">
        <div class="flex flex-wrap items-center gap-2.5">
          <PillTabs v-model="selectedCycle" :items="cycleItems" size="sm" />
          <span
            class="text-success-text bg-success-text/15 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
          >
            {{ $t('settings.planBilling.saveUpTo', { percent: MAX_YEARLY_SAVINGS_PERCENT }) }}
          </span>
        </div>
        <span class="text-muted-foreground text-xs">{{ $t(`settings.planBilling.cycleHint.${selectedCycle}`) }}</span>
      </div>

      <div class="grid grid-cols-1 gap-3.5 @2xl/plan-billing:grid-cols-3">
        <article
          v-for="card in cards"
          :key="card.tier"
          :class="
            cn(
              'relative flex flex-col gap-3.5 rounded-lg border p-5',
              card.comingSoon && 'border-muted-foreground/45 bg-hatched border-dashed',
              card.view?.isRecommended && 'border-primary ring-primary ring-1 ring-inset',
              card.view?.isCurrent && 'border-success-text/50',
            )
          "
        >
          <span
            v-if="card.comingSoon"
            class="bg-muted text-muted-foreground absolute -top-2.5 left-4 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
          >
            {{ $t('settings.planBilling.planned') }}
          </span>
          <span
            v-else-if="card.view && (card.view.isCurrent || card.view.isRecommended)"
            class="bg-card absolute -top-2.5 left-4 rounded-full"
          >
            <StatusBadge v-if="card.view.isCurrent" variant="success">
              {{ $t('settings.planBilling.yourPlan') }}
            </StatusBadge>
            <StatusBadge v-else variant="info">
              {{ $t(view.lastTier ? 'settings.planBilling.previousPlan' : 'settings.planBilling.recommended') }}
            </StatusBadge>
          </span>

          <div :class="cn(card.comingSoon && 'opacity-80')">
            <h3 class="text-lg font-bold tracking-tight">
              {{ $t(`settings.planBilling.tiers.${card.tier}.name`) }}
            </h3>
            <p class="text-muted-foreground mt-0.5 min-h-[2lh] text-sm">
              {{ $t(`settings.planBilling.tiers.${card.tier}.tagline`) }}
            </p>
          </div>

          <template v-if="card.prices">
            <div>
              <div class="flex flex-wrap items-baseline gap-1.5">
                <span class="text-3xl leading-none font-extrabold tracking-tight tabular-nums">
                  {{ formatUsd(card.prices[selectedCycle]) }}
                </span>
                <span class="text-muted-foreground text-sm">
                  {{ $t(`settings.planBilling.perCycle.${selectedCycle}`) }}
                </span>
              </div>
              <i18n-t
                :keypath="`settings.planBilling.price.${selectedCycle}Footnote`"
                tag="p"
                class="text-muted-foreground mt-1.5 text-xs tabular-nums"
              >
                <template #amount>{{
                  formatUsd(selectedCycle === 'year' ? card.prices.year / 12 : card.prices.year)
                }}</template>
                <template #struck>
                  <s class="opacity-70">{{ formatUsd(card.prices.month * 12) }}</s>
                </template>
                <template #save>
                  <span class="text-success-text font-bold">
                    {{
                      $t('settings.planBilling.price.save', {
                        amount: formatUsd(yearlySavings({ tier: card.tier })),
                      })
                    }}
                  </span>
                </template>
              </i18n-t>
            </div>
          </template>
          <div v-else class="opacity-80">
            <span class="text-xl leading-none font-extrabold tracking-tight">
              {{ $t('settings.planBilling.tiers.premium.priceTba') }}
            </span>
            <p class="text-muted-foreground mt-1.5 text-xs">
              {{ $t('settings.planBilling.tiers.premium.priceNote') }}
            </p>
          </div>

          <ul :class="cn('flex-1 space-y-2 text-sm', card.comingSoon && 'opacity-80')">
            <li
              v-for="(key, index) in card.featureKeys"
              :key="key"
              :class="cn('flex items-start gap-2', index === 0 && card.tier !== 'essential' && 'text-muted-foreground')"
            >
              <ClockIcon v-if="card.comingSoon" class="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <CheckIcon v-else class="text-success-text mt-0.5 size-4 shrink-0" />
              <span>{{ $t(`settings.planBilling.tiers.${card.tier}.features.${key}`) }}</span>
            </li>
          </ul>

          <div v-if="card.comingSoon" class="grid gap-1.5">
            <Button variant="outline" as="a" :href="EXTERNAL_URLS.featurebaseRoadmap" target="_blank" rel="noopener">
              {{ $t('settings.planBilling.voteOnRoadmap') }}
            </Button>
            <small class="text-muted-foreground min-h-lh text-center text-xs">
              {{ $t('settings.planBilling.roadmapNote') }}
            </small>
          </div>
          <div v-else-if="card.view" class="grid gap-1.5">
            <Button
              :variant="card.view.cta.variant"
              :disabled="card.view.cta.disabled || opening !== null"
              @click="handleCta(card)"
            >
              <LoaderCircleIcon v-if="opening === card.tier" class="size-4 animate-spin" />
              {{ card.view.cta.label }}
            </Button>
            <small class="text-muted-foreground min-h-lh text-center text-xs">{{ card.view.cta.note }}</small>
          </div>
        </article>
      </div>

      <p class="text-muted-foreground text-xs">
        {{ $t('settings.planBilling.priceNote') }}
      </p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { createBillingCheckout, createBillingPortalSession } from '@/api/billing';
import {
  DISPLAY_PRICES,
  FEATURE_KEYS,
  MAX_YEARLY_SAVINGS_PERCENT,
  liveSubscription,
  yearlySavings,
} from '@/common/const/billing';
import DocsLink from '@/components/common/docs-link.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { useNotificationCenter } from '@/components/notification-center';
import { useDateLocale } from '@/composable/use-date-locale';
import { extractApiErrorMessage, isApiErrorWithCode } from '@/js/errors';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { EXTERNAL_URLS } from '@bt/shared/const/external-urls';
import { API_ERROR_CODES, BILLING_CYCLES, type BillingCycle, type BillingTier } from '@bt/shared/types';
import { CheckIcon, ClockIcon, LoaderCircleIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { type Translate, buildPlanBillingView, formatUsd } from './view-model';

const CHECKOUT_POLL_INTERVAL_MS = 2000;
const CHECKOUT_POLL_ATTEMPTS = 15;

const { t } = useI18n();
const { format } = useDateLocale();
const route = useRoute();
const router = useRouter();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();
const userStore = useUserStore();
const { entitlements, trialDaysLeft } = storeToRefs(userStore);

const opening = ref<BillingTier | 'portal' | null>(null);
const checkoutSucceeded = ref(route.query.checkout === 'success');
const activationOutcome = ref<'timedOut' | 'unreachable' | null>(null);
const selectedCycle = ref<BillingCycle>('year');
const showReadOnlyHelp = computed(
  () => Boolean(entitlements.value?.readOnly) && !checkoutSucceeded.value && !activationOutcome.value,
);

// Entitlements arrive after the first render, so the toggle follows the paid cycle once it lands.
watch(
  () => liveSubscription({ entitlements: entitlements.value })?.billingCycle,
  (cycle) => {
    if (cycle) selectedCycle.value = cycle;
  },
  { immediate: true },
);

const translate: Translate = (key, params) => (typeof params === 'number' ? t(key, params) : t(key, params ?? {}));
const formatDate = (iso: string) => format(iso, 'MMM d, yyyy');

const view = computed(() =>
  buildPlanBillingView({
    entitlements: entitlements.value,
    selectedCycle: selectedCycle.value,
    checkoutSucceeded: checkoutSucceeded.value,
    activationOutcome: activationOutcome.value,
    trialDaysLeft: trialDaysLeft.value,
    t: translate,
    formatDate,
  }),
);

const cycleItems = computed(() =>
  Object.values(BILLING_CYCLES).map((cycle) => ({
    value: cycle,
    label: t(`settings.planBilling.cycle.${cycle}`),
  })),
);

const cards = computed(() => [
  {
    tier: 'essential' as const,
    featureKeys: FEATURE_KEYS.essential,
    prices: DISPLAY_PRICES.essential,
    view: view.value.tiers.essential,
    comingSoon: false,
  },
  {
    tier: 'plus' as const,
    featureKeys: FEATURE_KEYS.plus,
    prices: DISPLAY_PRICES.plus,
    view: view.value.tiers.plus,
    comingSoon: false,
  },
  {
    tier: 'premium' as const,
    featureKeys: FEATURE_KEYS.premium,
    prices: null,
    view: null,
    comingSoon: true,
  },
]);

// Backend messages are internal wording except under these codes, where the billing
// services write copy meant for the buyer ("already subscribed", "no Stripe customer yet").
const BUYER_FACING_ERROR_CODES = [
  API_ERROR_CODES.planRequired,
  API_ERROR_CODES.validationError,
  API_ERROR_CODES.notFound,
];

const billingErrorMessage = ({ error, fallbackKey }: { error: unknown; fallbackKey: string }) =>
  (BUYER_FACING_ERROR_CODES.some((code) => isApiErrorWithCode(error, code)) && extractApiErrorMessage(error)) ||
  t(fallbackKey);

// Cleared only on failure: a successful call assigns window.location, and the spinner must
// keep running through the unload that follows.
const openPortal = async ({ flow, tier }: { flow?: 'subscription_update'; tier?: BillingTier } = {}) => {
  opening.value = tier ?? 'portal';

  try {
    const { url } = await createBillingPortalSession({ flow });
    window.location.assign(url);
  } catch (error) {
    opening.value = null;
    addErrorNotification(billingErrorMessage({ error, fallbackKey: 'settings.planBilling.portalFailed' }));
    captureException({ error, context: { scope: 'billing:portal', flow } });
  }
};

const handleSubscribe = async ({ tier, cycle }: { tier: BillingTier; cycle: BillingCycle }) => {
  opening.value = tier;
  trackAnalyticsEvent({
    event: 'checkout_opened',
    properties: { tier, cycle, plan: entitlements.value?.plan ?? null },
  });

  try {
    const { url } = await createBillingCheckout({ tier, cycle });
    window.location.assign(url);
  } catch (error) {
    opening.value = null;
    addErrorNotification(billingErrorMessage({ error, fallbackKey: 'settings.planBilling.checkoutFailed' }));
    captureException({ error, context: { scope: 'billing:checkout', tier } });
  }
};

const handleCta = (card: (typeof cards.value)[number]) => {
  const action = card.view?.cta.action;
  if (!action) return;

  if (action.kind === 'appStore') {
    window.open(EXTERNAL_URLS.appStoreSubscriptions, '_blank', 'noopener');
    return;
  }
  if (action.kind === 'checkout') {
    void handleSubscribe(action);
    return;
  }
  void openPortal(action);
};

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let successfulRefreshes = 0;
let lastError: unknown;
let stopped = false;

// The subscription webhook lands a few seconds after checkout, so the new
// entitlements are not in the response that rendered this page.
const pollEntitlements = (attempt = 1) => {
  pollTimer = setTimeout(async () => {
    try {
      await userStore.loadUser();
      successfulRefreshes += 1;
    } catch (error) {
      // A refresh that fails still burns an attempt, so a broken session cannot loop forever.
      lastError = error;
    }

    if (stopped) return;

    if (view.value.activeTier) {
      checkoutSucceeded.value = false;
      addSuccessNotification(t('settings.planBilling.checkoutSuccess'));
      return;
    }

    if (attempt >= CHECKOUT_POLL_ATTEMPTS) {
      checkoutSucceeded.value = false;
      activationOutcome.value = successfulRefreshes === 0 ? 'unreachable' : 'timedOut';
      captureException({
        error: new Error('Checkout returned but entitlements never activated'),
        context: { scope: 'billing:checkout-poll', attempts: attempt, successfulRefreshes, lastError },
      });
      return;
    }

    pollEntitlements(attempt + 1);
  }, CHECKOUT_POLL_INTERVAL_MS);
};

onMounted(() => {
  if (!checkoutSucceeded.value) return;

  router.replace({ name: ROUTES_NAMES.settingsPlanBilling });
  pollEntitlements();
});

onUnmounted(() => {
  stopped = true;
  clearTimeout(pollTimer);
});
</script>
