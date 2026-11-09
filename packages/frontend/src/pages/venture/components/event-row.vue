<script setup lang="ts">
import { formatShortDate } from '@/common/utils/date';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { useFormatCurrency } from '@/composable/formatters';
import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE, type VentureEventModel } from '@bt/shared/types';
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  CoinsIcon,
  DoorOpenIcon,
  PhoneCallIcon,
  Trash2Icon,
  Undo2Icon,
  type LucideIcon,
} from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  event: VentureEventModel;
  currencyCode: string;
}>();

const emit = defineEmits<{
  delete: [event: VentureEventModel];
}>();

const { t } = useI18n();
const { formatAmountByCurrencyCode } = useFormatCurrency();

type Tone = 'invest' | 'distribute' | 'fee' | 'nav' | 'writedown' | 'exit';

interface EventVisual {
  icon: LucideIcon;
  tone: Tone;
}

const EVENT_VISUALS: Record<VENTURE_EVENT_TYPE, EventVisual> = {
  [VENTURE_EVENT_TYPE.initial_investment]: { icon: ArrowDownToLineIcon, tone: 'invest' },
  [VENTURE_EVENT_TYPE.capital_call]: { icon: PhoneCallIcon, tone: 'invest' },
  [VENTURE_EVENT_TYPE.capital_refund]: { icon: Undo2Icon, tone: 'distribute' },
  [VENTURE_EVENT_TYPE.fee_payment]: { icon: CoinsIcon, tone: 'fee' },
  [VENTURE_EVENT_TYPE.distribution]: { icon: ArrowUpFromLineIcon, tone: 'distribute' },
  [VENTURE_EVENT_TYPE.exit]: { icon: DoorOpenIcon, tone: 'exit' },
  [VENTURE_EVENT_TYPE.nav_update]: { icon: ActivityIcon, tone: 'nav' },
  [VENTURE_EVENT_TYPE.writedown]: { icon: AlertTriangleIcon, tone: 'writedown' },
};

const TONE_STYLES: Record<Tone, { chip: string; icon: string }> = {
  invest: {
    chip: 'bg-app-transfer-color/15 text-app-transfer-color border-app-transfer-color/30',
    icon: 'bg-app-transfer-color/15 text-app-transfer-color',
  },
  distribute: {
    chip: 'bg-app-income-color/15 text-app-income-color border-app-income-color/30',
    icon: 'bg-app-income-color/15 text-app-income-color',
  },
  exit: {
    chip: 'bg-app-income-color/20 text-app-income-color border-app-income-color/40',
    icon: 'bg-app-income-color/20 text-app-income-color',
  },
  fee: {
    chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  nav: {
    chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
    icon: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  },
  writedown: {
    chip: 'bg-destructive/15 text-destructive-text border-destructive/30',
    icon: 'bg-destructive/15 text-destructive-text',
  },
};

const visual = computed(() => EVENT_VISUALS[props.event.type]);
const toneStyle = computed(() => TONE_STYLES[visual.value.tone]);

const primaryAmount = computed<{ value: string; label: string } | null>(() => {
  const event = props.event;
  if (event.lpNetAmount !== null && event.lpNetAmount !== undefined) {
    return {
      value: formatAmountByCurrencyCode(Number(event.lpNetAmount), props.currencyCode),
      label: t('venture.events.lpNet'),
    };
  }
  if (event.navAfter !== null && event.navAfter !== undefined) {
    return {
      value: formatAmountByCurrencyCode(Number(event.navAfter), props.currencyCode),
      label: t('venture.events.navAfter'),
    };
  }
  if (event.grossAmount !== null && event.grossAmount !== undefined) {
    return {
      value: formatAmountByCurrencyCode(Number(event.grossAmount), props.currencyCode),
      label: t('venture.events.gross'),
    };
  }
  return null;
});

const showGross = computed(
  () => props.event.grossAmount !== null && primaryAmount.value?.label !== t('venture.events.gross'),
);
const showCarry = computed(() => props.event.gpCarryAmount !== null && Number(props.event.gpCarryAmount) > 0);
const showNav = computed(
  () => props.event.navAfter !== null && primaryAmount.value?.label !== t('venture.events.navAfter'),
);
</script>

<template>
  <li class="group bg-card border-border rounded-xl border p-4">
    <div class="flex items-start gap-4">
      <div :class="['flex size-10 shrink-0 items-center justify-center rounded-lg', toneStyle.icon]">
        <component :is="visual.icon" class="size-5" />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            :class="[
              'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tracking-wide uppercase',
              toneStyle.chip,
            ]"
          >
            {{ $t(`venture.events.types.${event.type}`) }}
          </span>
          <span class="text-muted-foreground text-xs">{{ formatShortDate(event.eventDate) }}</span>
          <span
            v-if="event.cashFlowMode === VENTURE_CASH_FLOW_MODE.out_of_wallet"
            class="border-border text-muted-foreground inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] tracking-wide uppercase"
          >
            {{ $t('venture.events.outOfWalletBadge') }}
          </span>
          <span
            v-if="event.gpCarryOverridden || event.lpNetAmountOverridden"
            class="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-400"
          >
            {{ $t('venture.events.manualBadge') }}
          </span>
        </div>

        <div v-if="primaryAmount" class="mt-2 flex items-baseline gap-2">
          <span class="text-2xl leading-none font-medium tabular-nums">{{ primaryAmount.value }}</span>
          <span class="text-muted-foreground text-[11px] tracking-wide uppercase">{{ primaryAmount.label }}</span>
        </div>

        <dl class="text-muted-foreground mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs @sm/venture-deal:grid-cols-3">
          <div v-if="showGross">
            <dt class="text-[10px] tracking-wide uppercase">{{ $t('venture.events.gross') }}</dt>
            <dd class="text-foreground font-medium tabular-nums">
              {{ formatAmountByCurrencyCode(Number(event.grossAmount), currencyCode) }}
            </dd>
          </div>
          <div v-if="showCarry">
            <dt class="text-[10px] tracking-wide uppercase">{{ $t('venture.events.carry') }}</dt>
            <dd class="text-foreground font-medium tabular-nums">
              {{ formatAmountByCurrencyCode(Number(event.gpCarryAmount), currencyCode) }}
            </dd>
          </div>
          <div v-if="showNav">
            <dt class="text-[10px] tracking-wide uppercase">{{ $t('venture.events.navAfter') }}</dt>
            <dd class="text-foreground font-medium tabular-nums">
              {{ formatAmountByCurrencyCode(Number(event.navAfter), currencyCode) }}
            </dd>
          </div>
        </dl>

        <p v-if="event.notes" class="text-muted-foreground mt-2 line-clamp-2 text-xs italic">{{ event.notes }}</p>
      </div>

      <UiButton
        size="icon-sm"
        variant="ghost-destructive"
        class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        :aria-label="$t('venture.events.deleteEvent')"
        @click="emit('delete', event)"
      >
        <Trash2Icon class="size-4" />
      </UiButton>
    </div>
  </li>
</template>
