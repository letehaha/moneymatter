<template>
  <i18n-t keypath="analytics.fire.pace.row" tag="div" class="flex flex-wrap items-center gap-2 text-sm">
    <template #status>
      <span v-if="isError" class="text-muted-foreground inline-flex items-center gap-1.5">
        {{ $t('analytics.fire.pace.loadFailed') }}
        <Button variant="link" size="sm" class="h-auto p-0" @click="emit('retry')">
          {{ $t('common.actions.retry') }}
        </Button>
      </span>
      <span
        v-else-if="!pace"
        class="bg-muted inline-block h-8 w-32 animate-pulse rounded-full"
        role="status"
        :aria-label="$t('common.loading')"
      />
      <span v-else-if="!chip" class="text-muted-foreground inline-flex items-center gap-1.5">
        <CalendarIcon class="size-4" />
        {{ $t('analytics.fire.pace.noHistory', { month: anchorLabel }) }}
        <Button
          v-if="canCompareEarliest"
          variant="link"
          size="sm"
          class="h-auto p-0"
          @click="emit('change-anchor', earliestMonth)"
        >
          {{ $t('analytics.fire.pace.compareWith', { month: earliestLabel }) }}
        </Button>
      </span>
      <Popover v-else>
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            size="xs"
            :class="cn('gap-1.5 rounded-full px-3 font-bold tabular-nums', PACE_TONE_CLASS[chip.tone])"
          >
            <component :is="chip.icon" class="size-4" />
            {{ chip.label }}
            <ChevronDownIcon class="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" class="@container flex w-[min(40rem,calc(100vw-2rem))] flex-col gap-3">
          <div class="flex items-center justify-between gap-2">
            <p class="text-primary-text text-xs font-semibold tracking-wider uppercase">
              {{ $t('analytics.fire.pace.details.title', { month: anchorLabel }) }}
            </p>
            <span :class="cn('rounded-full px-2 py-0.5 text-xs font-bold', PACE_TONE_CLASS[chip.tone])">
              {{ chip.label }}
            </span>
          </div>

          <p class="text-muted-foreground text-sm tabular-nums">{{ summary }}</p>

          <ScrollArea class="border-border rounded-lg border" with-horizontal-scrollbar>
            <table class="w-full text-sm tabular-nums">
              <thead class="bg-muted text-muted-foreground text-xs uppercase">
                <tr>
                  <th scope="col" class="px-2.5 py-2 text-left font-semibold @md:px-3">
                    <span class="sr-only">{{ $t('analytics.fire.pace.details.metric') }}</span>
                  </th>
                  <th scope="col" class="px-2.5 py-2 text-left font-semibold @md:px-3">{{ anchorLabel }}</th>
                  <th scope="col" class="px-2.5 py-2 text-left font-semibold @md:px-3">
                    {{ $t('analytics.fire.pace.details.today') }}
                  </th>
                  <th scope="col" class="hidden px-3 py-2 text-right font-semibold @md:table-cell">
                    {{ $t('analytics.fire.pace.details.change') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.key" class="border-border border-t">
                  <th scope="row" class="px-2.5 py-2 text-left align-top font-semibold @md:px-3">{{ row.label }}</th>
                  <td class="text-muted-foreground px-2.5 py-2 align-top @md:px-3 @md:whitespace-nowrap">
                    {{ row.then }}
                  </td>
                  <td class="px-2.5 py-2 align-top font-bold whitespace-nowrap @md:px-3">
                    {{ row.now }}
                    <span
                      v-if="row.change"
                      :class="
                        cn('mt-1 block w-fit rounded-full px-2 py-0.5 text-xs @md:hidden', PACE_TONE_CLASS[row.tone])
                      "
                    >
                      {{ row.change }}
                    </span>
                  </td>
                  <td class="hidden px-3 py-2 text-right whitespace-nowrap @md:table-cell">
                    <span
                      v-if="row.change"
                      :class="cn('rounded-full px-2 py-0.5 text-xs font-bold', PACE_TONE_CLASS[row.tone])"
                    >
                      {{ row.change }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </ScrollArea>

          <p class="text-muted-foreground flex items-start gap-2 text-xs">
            <InfoIcon class="mt-0.5 size-3.5 shrink-0" />
            <span>
              <template v-if="tolerance">{{ $t('analytics.fire.pace.details.band', { tolerance }) }} </template>
              {{
                pace.usesRecordedSettings
                  ? $t('analytics.fire.pace.details.recorded', { date: asOfLabel })
                  : $t('analytics.fire.pace.details.notRecorded', { date: asOfLabel })
              }}
            </span>
          </p>
        </PopoverContent>
      </Popover>
    </template>
    <template #anchor>
      <FirePaceAnchorPicker
        :anchor="anchor"
        :earliest-month="earliestMonth"
        @change-anchor="emit('change-anchor', $event)"
      />
    </template>
  </i18n-t>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useFormatCurrency } from '@/composable';
import { type FirePace, type FirePaceAnchor, monthKey, parseMonthKey } from '@/composable/fire/fire-pace';
import {
  type FireChangeTone,
  PACE_TONE_CLASS,
  paceChip,
  paceTone,
  pctChange,
} from '@/composable/fire/fire-pace-display';
import { useDateLocale } from '@/composable/use-date-locale';
import { formatDuration } from '@/js/helpers/format-duration';
import { cn } from '@/lib/utils';
import { CalendarIcon, ChevronDownIcon, InfoIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import FirePaceAnchorPicker from './fire-pace-anchor-picker.vue';

const props = defineProps<{
  pace: FirePace | null;
  anchor: FirePaceAnchor;
  earliestMonth: string | null;
  isError: boolean;
}>();
const emit = defineEmits<{ 'change-anchor': [month: string | null]; retry: [] }>();

const { t } = useI18n();
const { format } = useDateLocale();
const { formatCompactBaseCurrency } = useFormatCurrency();

const chip = computed(() => (props.pace ? paceChip({ pace: props.pace, t }) : null));
const anchorLabel = computed(() => format(props.anchor.date, 'LLL yyyy'));
const earliestLabel = computed(() =>
  props.earliestMonth ? format(parseMonthKey({ month: props.earliestMonth })!, 'LLL yyyy') : '',
);
const canCompareEarliest = computed(
  () =>
    props.earliestMonth !== null &&
    props.earliestMonth < monthKey({ date: new Date() }) &&
    props.earliestMonth !== props.anchor.month,
);
const asOfLabel = computed(() => format(props.anchor.date, 'd LLL yyyy'));
const dateLabel = ({ date }: { date: Date | null }) =>
  date === null ? t('analytics.fire.pace.details.outOfReach') : format(date, 'LLL yyyy');
const tolerance = computed(() =>
  props.pace?.toleranceMonths == null ? null : formatDuration({ months: Math.round(props.pace.toleranceMonths), t }),
);

const summary = computed(() => {
  if (!props.pace) return '';
  const { verdict, anchorEta, currentEta } = props.pace;
  const month = anchorLabel.value;
  if (verdict === 'back-in-reach')
    return t('analytics.fire.pace.details.backInReach', { month, date: dateLabel({ date: currentEta }) });
  if (verdict === 'off-track')
    return t('analytics.fire.pace.details.offTrack', { month, date: dateLabel({ date: anchorEta }) });
  if (verdict === 'on-pace')
    return t('analytics.fire.pace.details.withinBand', {
      tolerance: tolerance.value,
      month,
      date: dateLabel({ date: anchorEta }),
    });
  return t('analytics.fire.pace.details.moved', {
    from: dateLabel({ date: anchorEta }),
    to: dateLabel({ date: currentEta }),
  });
});

const rows = computed(() => {
  const { pace } = props;
  if (!pace) return [];
  const shift = pace.shiftMonths;
  const fireTone: FireChangeTone = paceTone({ verdict: pace.verdict }) ?? 'neutral';
  const fireChange =
    shift === null
      ? null
      : shift === 0
        ? t('analytics.fire.pace.details.sameMonth')
        : t(shift < 0 ? 'analytics.fire.pace.details.sooner' : 'analytics.fire.pace.details.later', {
            duration: formatDuration({ months: Math.abs(shift), t }),
          });
  const perYear = ({ amount }: { amount: number | null }) =>
    amount === null ? '—' : t('analytics.fire.perYear', { amount: formatCompactBaseCurrency({ amount }) });
  const perMonth = ({ amount }: { amount: number }) =>
    t('analytics.fire.perMonth', { amount: formatCompactBaseCurrency({ amount }) });

  return [
    {
      key: 'fire',
      label: t('analytics.fire.pace.details.fireDate'),
      then: dateLabel({ date: pace.anchorEta }),
      now: dateLabel({ date: pace.currentEta }),
      change: fireChange,
      tone: fireTone,
    },
    ...(pace.expectedBalance === null
      ? []
      : [
          {
            key: 'saved',
            label: t('analytics.fire.pace.details.saved'),
            then: t('analytics.fire.pace.details.expected', {
              amount: formatCompactBaseCurrency({ amount: pace.expectedBalance }),
            }),
            now: formatCompactBaseCurrency({ amount: pace.balance }),
            ...pctChange({ now: pace.balance, then: pace.expectedBalance, upIsGood: true }),
          },
        ]),
    {
      key: 'spending',
      label: t('analytics.fire.pace.details.spending'),
      then: perYear({ amount: pace.spending.then }),
      now: perYear({ amount: pace.spending.now }),
      ...pctChange({ now: pace.spending.now, then: pace.spending.then, upIsGood: false }),
    },
    {
      key: 'saving',
      label: t('analytics.fire.pace.details.saving'),
      then: perMonth({ amount: pace.contribution.then }),
      now: perMonth({ amount: pace.contribution.now }),
      ...pctChange({ now: pace.contribution.now, then: pace.contribution.then, upIsGood: true }),
    },
  ];
});
</script>
