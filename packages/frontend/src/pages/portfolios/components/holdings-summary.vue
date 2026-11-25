<template>
  <Card class="@container/holdings min-w-0">
    <CardHeader class="pb-4">
      <div class="flex flex-col gap-3 @lg/holdings:flex-row @lg/holdings:items-center @lg/holdings:justify-between">
        <InputField
          v-model="filterText"
          size="sm"
          class="w-full @lg/holdings:max-w-80"
          trailing-icon-css-class="px-2"
          :placeholder="$t('portfolioDetail.holdings.filterPlaceholder')"
        >
          <template #iconLeading>
            <SearchIcon class="text-muted-foreground size-4" />
          </template>
          <template v-if="filterText" #iconTrailing>
            <DesktopOnlyTooltip :content="$t('portfolioDetail.holdingsTable.clearFilterButton')">
              <UiButton
                variant="ghost"
                size="icon-sm"
                :aria-label="$t('portfolioDetail.holdingsTable.clearFilterButton')"
                @click="filterText = ''"
              >
                <XIcon class="size-4" />
              </UiButton>
            </DesktopOnlyTooltip>
          </template>
        </InputField>

        <div class="flex items-center gap-2">
          <UiButton size="sm" variant="outline" as-child>
            <RouterLink :to="{ name: ROUTES_NAMES.portfolioTransactionsImport, params: { portfolioId } }">
              <FileUpIcon class="size-4" />
              {{ $t('portfolioDetail.holdings.importButtonShort') }}
            </RouterLink>
          </UiButton>

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
        :portfolio-name="portfolioName"
        :weights="weights"
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
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import InputField from '@/components/fields/input-field.vue';
import { getHoldingWeights } from '@/components/holdings/utils/holding-display';
import { useHoldings } from '@/composable/data-queries/holdings';
import { ROUTES_NAMES } from '@/routes';
import { FileUpIcon, PlusIcon, SearchIcon, XIcon } from '@lucide/vue';
import { computed, ref, toRef } from 'vue';
import { RouterLink, useRouter } from 'vue-router';

const props = defineProps<{ portfolioId: string; portfolioName?: string }>();
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

const weights = computed(() => getHoldingWeights({ holdings: holdings.value ?? [] }));

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
