<template>
  <Card class="min-w-0">
    <CardHeader class="pb-4">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-3">
          <div class="bg-primary/10 flex size-9 items-center justify-center rounded-lg">
            <LayoutListIcon class="text-primary-text size-5" />
          </div>
          <div>
            <CardTitle class="text-lg">{{ $t('portfolioDetail.holdings.title') }}</CardTitle>
            <p v-if="holdings" class="text-muted-foreground text-sm">
              {{ $t('portfolioDetail.holdings.subtitle', { count: holdings.length }) }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <!-- Search Filter -->
          <div class="relative flex-1 sm:w-64">
            <SearchIcon class="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              v-model="filterText"
              type="text"
              :placeholder="$t('portfolioDetail.holdings.filterPlaceholder')"
              class="border-input bg-input-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border pr-8 pl-9 text-sm focus-visible:ring-1 focus-visible:outline-none"
            />
            <button
              v-if="filterText"
              @click="filterText = ''"
              class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
            >
              <XIcon class="size-4" />
            </button>
          </div>

          <RouterLink :to="{ name: ROUTES_NAMES.portfolioTransactionsImport, params: { portfolioId } }">
            <UiButton size="sm" variant="outline">
              <FileUpIcon class="size-4" />
              <span class="md:hidden">{{ $t('portfolioDetail.holdings.importButtonShort') }}</span>
              <span class="hidden md:inline">{{ $t('portfolioDetail.holdings.importButton') }}</span>
            </UiButton>
          </RouterLink>

          <AddSymbolsDialog v-model:open="isAddSymbolsOpen" :portfolio-id="portfolioId" @updated="onHoldingAdded">
            <UiButton size="sm">
              <PlusIcon class="size-4" />
              {{ $t('portfolioDetail.holdings.addButton') }}
            </UiButton>
          </AddSymbolsDialog>
        </div>
      </div>
    </CardHeader>
    <CardContent class="pt-0">
      <HoldingsTable
        :holdings="filteredHoldings || []"
        :loading="isLoading"
        :error="!!error"
        :portfolio-id="portfolioId"
        :is-filtering="isFiltering"
        :just-added-ids="justAddedIds"
        @add-symbol="isAddSymbolsOpen = true"
        @import-transactions="goToImport"
        @clear-filter="filterText = ''"
      />
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import AddSymbolsDialog from '@/components/dialogs/add-symbols-dialog.vue';
import HoldingsTable from '@/components/holdings/holdings-table.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/lib/ui/card';
import { useHoldings } from '@/composable/data-queries/holdings';
import { ROUTES_NAMES } from '@/routes';
import { FileUpIcon, LayoutListIcon, PlusIcon, SearchIcon, XIcon } from '@lucide/vue';
import { computed, ref, toRef } from 'vue';
import { RouterLink, useRouter } from 'vue-router';

const props = defineProps<{ portfolioId: string }>();
const portfolioId = toRef(props, 'portfolioId');
const router = useRouter();

const { data: holdings, isLoading, error, invalidate } = useHoldings(portfolioId);

const isAddSymbolsOpen = ref(false);
const filterText = ref('');

// Holdings the user just added in this session – pinned to the top of the
// table so they can keep adding transactions without scrolling. In-memory
// only by design: clearing on reload matches the user's mental model ("fresh
// page = nothing is 'new' anymore"). No sessionStorage.
const justAddedIds = ref<Set<string>>(new Set());

const onHoldingAdded = ({ securityId }: { securityId: string }) => {
  const next = new Set(justAddedIds.value);
  next.add(securityId);
  justAddedIds.value = next;
  invalidate();
};

function goToImport() {
  router.push({ name: ROUTES_NAMES.portfolioTransactionsImport, params: { portfolioId: portfolioId.value } });
}

const isFiltering = computed(() => !!filterText.value.trim());

const filteredHoldings = computed(() => {
  if (!holdings.value) return null;
  if (!isFiltering.value) return holdings.value;

  const searchTerm = filterText.value.toLowerCase().trim();
  return holdings.value.filter((holding) => {
    const symbol = holding.security?.symbol?.toLowerCase() || '';
    const name = holding.security?.name?.toLowerCase() || '';
    return symbol.includes(searchTerm) || name.includes(searchTerm);
  });
});
</script>
