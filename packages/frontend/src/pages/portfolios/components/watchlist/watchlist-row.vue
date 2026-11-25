<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import SecurityLogo from '@/components/common/security-logo.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { toLocalNumber } from '@/js/helpers/formatters';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import type { RecordId, WatchlistItemModel, WatchlistSectionModel } from '@bt/shared/types';
import { BellIcon, EllipsisIcon, PencilIcon, Trash2Icon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { useFormatWatchlistPrice } from './use-watchlist';
import { NO_SECTION, distanceToTargetPercent, rangePositionPercent } from './watchlist-helpers';

const props = defineProps<{
  item: WatchlistItemModel;
  portfolioId: string;
  sections: Pick<WatchlistSectionModel, 'id' | 'name'>[];
  buyDisabled: boolean;
  indented: boolean;
}>();

const emit = defineEmits<{
  alerts: [];
  buy: [];
  edit: [];
  remove: [];
  move: [sectionId: RecordId | null];
}>();

const { format: formatDate } = useDateLocale();
const formatWatchlistPrice = useFormatWatchlistPrice();

const formatPrice = ({ value }: { value: string | null }) =>
  formatWatchlistPrice({ value, currencyCode: props.item.security.currencyCode });
const formatPercent = ({ value, options = {} }: { value: number; options?: Intl.NumberFormatOptions }) =>
  `${toLocalNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...options })}%`;

const change = computed(() => props.item.changePercent);
const distance = computed(() => distanceToTargetPercent({ item: props.item }));
const rangePosition = computed(() => rangePositionPercent({ item: props.item }));
const activeAlerts = computed(() => props.item.alerts.filter((alert) => alert.isActive).length);

const holdingRoute = computed(() => ({
  name: ROUTES_NAMES.portfolioHolding,
  params: { portfolioId: props.portfolioId, securityId: props.item.security.id },
}));

const onMove = (value: unknown) => emit('move', value === NO_SECTION ? null : (String(value) as RecordId));
</script>

<template>
  <tr class="hover:bg-hover border-border border-t text-sm">
    <td :class="cn('py-2.5 pr-3', indented ? 'pl-10' : 'pl-3')">
      <component
        :is="item.isHeld ? RouterLink : 'div'"
        :to="item.isHeld ? holdingRoute : undefined"
        class="flex min-w-0 items-center gap-3"
      >
        <SecurityLogo :security="item.security" class="size-8 shrink-0" />
        <span class="min-w-0">
          <span class="flex items-center gap-1.5 font-semibold">
            {{ item.security.symbol }}
            <span
              v-if="item.isHeld"
              class="bg-primary/10 text-primary-text rounded px-1.5 py-0.5 text-xs font-bold tracking-wide uppercase"
            >
              {{ $t('portfolioDetail.watchlist.heldBadge') }}
            </span>
          </span>
          <span class="text-muted-foreground block max-w-56 truncate text-xs">{{ item.security.name }}</span>
        </span>
      </component>
    </td>

    <td class="px-3 py-2.5 text-right tabular-nums">
      <span class="block font-semibold">{{ formatPrice({ value: item.lastClose }) }}</span>
      <span v-if="item.lastCloseDate" class="text-muted-foreground block text-xs">
        {{ formatDate(parseISO(item.lastCloseDate), 'MMM d') }}
      </span>
    </td>

    <td
      :class="
        cn(
          'px-3 py-2.5 text-right font-semibold tabular-nums',
          change !== null && getGainColorClass({ gainValue: change }),
        )
      "
    >
      {{ change === null ? '—' : formatPercent({ value: change, options: { signDisplay: 'exceptZero' } }) }}
    </td>

    <td class="px-3 py-2.5">
      <div v-if="rangePosition !== null" class="flex max-w-32 flex-col gap-1.5">
        <div class="bg-muted relative h-1 rounded-full">
          <span
            class="bg-foreground absolute -top-[3px] size-2.5 -translate-x-1/2 rounded-full"
            :style="{ left: `${rangePosition}%` }"
          />
        </div>
        <div class="text-muted-foreground flex justify-between gap-2 text-xs tabular-nums">
          <span>{{ formatPrice({ value: item.low52w }) }}</span>
          <span>{{ formatPrice({ value: item.high52w }) }}</span>
        </div>
      </div>
      <span v-else class="text-muted-foreground text-sm">{{ $t('portfolioDetail.watchlist.rangeUnavailable') }}</span>
    </td>

    <td class="px-3 py-2.5 text-right tabular-nums">
      <template v-if="item.targetPrice">
        <span class="block font-semibold">{{ formatPrice({ value: item.targetPrice }) }}</span>
        <span v-if="distance !== null && distance <= 0" class="text-success-text block text-xs font-semibold">
          {{ $t('portfolioDetail.watchlist.inBuyZone') }}
        </span>
        <span v-else-if="distance !== null" class="text-muted-foreground block text-xs">
          {{
            $t('portfolioDetail.watchlist.toGo', {
              percent: formatPercent({
                value: distance,
                options: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
              }),
            })
          }}
        </span>
      </template>
      <span v-else class="text-muted-foreground">—</span>
    </td>

    <td class="text-muted-foreground max-w-56 px-3 py-2.5">
      <DesktopOnlyTooltip
        :content="item.note ?? undefined"
        :disabled="!item.note"
        content-class-name="whitespace-pre-line"
        only-when-truncated
      >
        <span class="block truncate">{{ item.note || '—' }}</span>
      </DesktopOnlyTooltip>
    </td>

    <td class="py-2.5 pr-3 pl-1">
      <div class="flex items-center justify-end gap-1">
        <DesktopOnlyTooltip
          :content="
            activeAlerts
              ? $t('portfolioDetail.watchlist.alertsActive', { count: activeAlerts })
              : $t('portfolioDetail.watchlist.alertsNone')
          "
        >
          <Button
            variant="ghost"
            size="icon-sm"
            :class="cn('relative hover:bg-transparent', activeAlerts ? 'text-primary-text' : 'text-muted-foreground')"
            :aria-label="$t('portfolioDetail.watchlist.alertsFor', { symbol: item.security.symbol })"
            @click="emit('alerts')"
          >
            <BellIcon class="size-4" />
            <span
              v-if="activeAlerts"
              class="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs leading-none font-bold"
            >
              {{ activeAlerts }}
            </span>
          </Button>
        </DesktopOnlyTooltip>

        <Button variant="outline" size="xs" :disabled="buyDisabled" @click="emit('buy')">
          {{ $t('portfolioDetail.watchlist.buy') }}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <span class="inline-flex">
              <DesktopOnlyTooltip :content="$t('common.actions.more')">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="hover:bg-transparent"
                  :aria-label="$t('portfolioDetail.watchlist.moreFor', { symbol: item.security.symbol })"
                >
                  <EllipsisIcon class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-56">
            <DropdownMenuItem @click="emit('edit')">
              <PencilIcon class="size-4" />
              {{ $t('portfolioDetail.watchlist.items.editAction') }}
            </DropdownMenuItem>
            <template v-if="sections.length">
              <DropdownMenuSeparator />
              <DropdownMenuLabel class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                {{ $t('portfolioDetail.watchlist.items.moveTo') }}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup :model-value="item.sectionId ?? NO_SECTION" @update:model-value="onMove">
                <DropdownMenuRadioItem :value="NO_SECTION">
                  {{ $t('portfolioDetail.watchlist.notInSection') }}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem v-for="section in sections" :key="section.id" :value="section.id">
                  {{ section.name }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </template>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="text-destructive-text" @click="emit('remove')">
              <Trash2Icon class="size-4" />
              {{ $t('portfolioDetail.watchlist.items.remove') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </td>
  </tr>
</template>
