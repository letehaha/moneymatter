<template>
  <PageWrapper>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
      <h1 class="text-2xl tracking-wider">{{ $t('investments.title') }}</h1>

      <DemoRestricted feature="create_portfolio_header" :message="$t('demo.featureNotAvailable')">
        <CreatePortfolioDialog v-if="!isDemo">
          <UiButton>
            <PlusIcon class="size-4" />
            {{ $t('investments.createButton') }}
          </UiButton>
        </CreatePortfolioDialog>
        <UiButton v-else disabled>
          <PlusIcon class="size-4" />
          {{ $t('investments.createButton') }}
        </UiButton>
      </DemoRestricted>
    </div>

    <template v-if="portfoliosQuery.isLoading.value">
      <div class="mb-6 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        <Card v-for="i in 3" :key="i" class="overflow-hidden">
          <CardHeader class="p-4 pb-2">
            <div class="flex items-start gap-3">
              <div class="bg-muted size-10 shrink-0 animate-pulse rounded-lg" />
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="bg-muted h-5 w-32 animate-pulse rounded" />
                <div class="bg-muted h-3 w-20 animate-pulse rounded" />
              </div>
            </div>
          </CardHeader>
          <CardContent class="p-4 pt-2">
            <div class="space-y-1.5">
              <div class="bg-muted h-7 w-28 animate-pulse rounded" />
              <div class="bg-muted h-5 w-24 animate-pulse rounded" />
              <div class="bg-muted h-4 w-20 animate-pulse rounded" />
            </div>
          </CardContent>
        </Card>
      </div>
    </template>

    <template v-else-if="portfoliosQuery.error.value">
      <div class="py-12 text-center">
        <div class="text-destructive-text mb-4">{{ $t('investments.loadError') }}</div>
        <UiButton @click="portfoliosQuery.refetch()">{{ $t('investments.tryAgain') }}</UiButton>
      </div>
    </template>

    <template v-else-if="portfolios.length">
      <div class="mb-6 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        <template v-for="portfolio in portfolios" :key="portfolio.id">
          <Card
            :class="
              cn(
                'group relative overflow-hidden transition-all duration-200 hover:shadow-md',
                !portfolio.isEnabled && 'opacity-60',
              )
            "
          >
            <!-- Disabled overlay indicator -->
            <div
              v-if="!portfolio.isEnabled"
              class="to-muted/20 pointer-events-none absolute inset-0 z-10 bg-linear-to-br from-transparent via-transparent"
            >
              <div class="absolute top-3 left-3">
                <div
                  class="bg-secondary text-secondary-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                >
                  <EyeOffIcon class="mr-1 size-3" />
                  {{ $t('investments.card.hidden') }}
                </div>
              </div>
            </div>

            <!-- Menu button -->
            <div class="absolute top-3 right-3 z-20">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <UiButton
                    variant="ghost"
                    size="icon"
                    class="size-8 opacity-0 transition-opacity group-hover:opacity-100"
                    :class="{ 'opacity-100': !portfolio.isEnabled }"
                  >
                    <MoreVerticalIcon class="size-4" />
                  </UiButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <RouterLink
                      :to="{
                        name: ROUTES_NAMES.portfolioDetail,
                        params: { portfolioId: portfolio.id },
                      }"
                      class="flex w-full items-center"
                    >
                      <EyeIcon class="mr-2 size-4" />
                      {{ $t('investments.menu.view') }}
                    </RouterLink>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DeletePortfolioDialog v-if="!isDemo" :portfolio-id="portfolio.id">
                    <DropdownMenuItem
                      class="text-destructive-text focus:bg-destructive-text/10 focus:text-destructive-text"
                      @select.prevent
                    >
                      <Trash2Icon class="mr-2 size-4" />
                      {{ $t('investments.menu.delete') }}
                    </DropdownMenuItem>
                  </DeletePortfolioDialog>
                  <DemoRestricted v-else feature="delete_portfolio" :message="$t('demo.featureNotAvailable')">
                    <DropdownMenuItem
                      disabled
                      class="text-destructive-text focus:bg-destructive-text/10 focus:text-destructive-text"
                      @select.prevent
                    >
                      <Trash2Icon class="mr-2 size-4" />
                      {{ $t('investments.menu.delete') }}
                    </DropdownMenuItem>
                  </DemoRestricted>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <router-link
              :to="{
                name: ROUTES_NAMES.portfolioDetail,
                params: { portfolioId: portfolio.id },
              }"
              class="block h-full"
            >
              <CardHeader class="p-4 pb-2">
                <div class="flex items-start gap-3">
                  <!-- Portfolio type icon -->
                  <div
                    :class="[
                      'flex size-10 shrink-0 items-center justify-center rounded-lg',
                      getPortfolioTypeColor(portfolio.portfolioType),
                    ]"
                  >
                    <component :is="getPortfolioTypeIcon(portfolio.portfolioType)" class="size-5" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <h3 class="truncate text-base leading-tight font-semibold tracking-tight">
                      {{ portfolio.name }}
                    </h3>
                    <p class="text-muted-foreground mt-0.5 text-xs">
                      {{ $t('investments.card.portfolioType', { type: formatPortfolioType(portfolio.portfolioType) }) }}
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardContent class="p-4 pt-2">
                <PortfolioCardBalance :portfolio-id="portfolio.id" :currencies="currencies" />

                <!-- Description -->
                <p v-if="portfolio.description" class="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
                  {{ portfolio.description }}
                </p>
              </CardContent>
            </router-link>
          </Card>
        </template>
      </div>
    </template>

    <template v-else>
      <div class="py-16 text-center">
        <div class="mb-6">
          <div class="bg-muted mx-auto mb-4 flex size-16 items-center justify-center rounded-full">
            <BriefcaseIcon class="text-muted-foreground size-8" />
          </div>
          <h3 class="text-foreground mb-2 text-xl font-semibold">{{ $t('investments.empty.title') }}</h3>
          <p class="text-muted-foreground mx-auto max-w-md text-base">
            {{ $t('investments.empty.description') }}
          </p>
        </div>
        <DemoRestricted feature="create_portfolio_empty_state" :message="$t('demo.featureNotAvailable')">
          <CreatePortfolioDialog v-if="!isDemo">
            <UiButton size="lg">
              <PlusIcon class="size-4" />
              {{ $t('investments.empty.createFirstButton') }}
            </UiButton>
          </CreatePortfolioDialog>
          <UiButton v-else size="lg" disabled>
            <PlusIcon class="size-4" />
            {{ $t('investments.empty.createFirstButton') }}
          </UiButton>
        </DemoRestricted>
      </div>
    </template>

    <PortfoliosTrash v-if="!isDemo" />
  </PageWrapper>
</template>

<script lang="ts" setup>
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { DemoRestricted } from '@/components/demo';
import CreatePortfolioDialog from '@/components/dialogs/create-portfolio-dialog.vue';
import DeletePortfolioDialog from '@/components/dialogs/delete-portfolio-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { usePortfolios } from '@/composable/data-queries/portfolios';
import { cn } from '@/lib/utils';
import PortfolioCardBalance from '@/pages/investments/components/portfolio-card-balance.vue';
import PortfoliosTrash from '@/pages/investments/components/portfolios-trash.vue';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCurrenciesStore, useUserStore } from '@/stores';
import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import {
  BriefcaseIcon,
  Building2Icon,
  EyeIcon,
  EyeOffIcon,
  LandmarkIcon,
  MoreVerticalIcon,
  PiggyBankIcon,
  PlusIcon,
  Trash2Icon,
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import type { FunctionalComponent } from 'vue';
import { computed } from 'vue';

const userStore = useUserStore();
const { isDemo } = storeToRefs(userStore);
const currenciesStore = useCurrenciesStore();
const { currencies } = storeToRefs(currenciesStore);
const portfoliosQuery = usePortfolios();

// Copy before sorting: sort() mutates in place, and the source array is the query cache.
const portfolios = computed(() => [...(portfoliosQuery.data.value ?? [])].sort((a, b) => +b.isEnabled - +a.isEnabled));

// Portfolio type icon mapping
const getPortfolioTypeIcon = (type: PORTFOLIO_TYPE): FunctionalComponent => {
  const iconMap: Record<PORTFOLIO_TYPE, FunctionalComponent> = {
    [PORTFOLIO_TYPE.investment]: Building2Icon,
    [PORTFOLIO_TYPE.retirement]: LandmarkIcon,
    [PORTFOLIO_TYPE.savings]: PiggyBankIcon,
    [PORTFOLIO_TYPE.other]: BriefcaseIcon,
  };
  return iconMap[type] || BriefcaseIcon;
};

// Portfolio type color mapping
const getPortfolioTypeColor = (type: PORTFOLIO_TYPE): string => {
  const colorMap: Record<PORTFOLIO_TYPE, string> = {
    [PORTFOLIO_TYPE.investment]: 'bg-blue-500/10 text-blue-600',
    [PORTFOLIO_TYPE.retirement]: 'bg-emerald-500/10 text-emerald-600',
    [PORTFOLIO_TYPE.savings]: 'bg-amber-500/10 text-amber-600',
    [PORTFOLIO_TYPE.other]: 'bg-slate-500/10 text-slate-600',
  };
  return colorMap[type] || 'bg-slate-500/10 text-slate-600';
};

// Format portfolio type for display (capitalize and replace underscores)
const formatPortfolioType = (type: string): string => {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};
</script>
