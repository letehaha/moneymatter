<script setup lang="ts">
import { config } from '@/common/config';
import { getServiceLogoUrl } from '@/common/utils/logo-url';
import { clampInitials, deriveInitials } from '@/common/utils/monogram-initials';
import AsyncLogo from '@/components/common/async-logo.vue';
import BrandLogo from '@/components/common/brand-logo.vue';
import IconPickerDropdown from '@/components/common/icons/icon-picker-dropdown.vue';
import LogoColorPicker from '@/components/common/logo-color-picker.vue';
import {
  DEFAULT_LOGO_TABS,
  DEFAULT_MONOGRAM_COLOR,
  type LogoSelection,
  type LogoTab,
} from '@/components/common/logo-selection';
import { Button } from '@/components/lib/ui/button';
import { Label } from '@/components/lib/ui/label';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/lib/ui/tabs';
import {
  type BrandLogoSearchResult,
  LOGO_SEARCH_MIN_QUERY_LENGTH,
  useSearchBrandLogo,
} from '@/composable/data-queries/brand-logos';
import { cn } from '@/lib/utils';
import { AlertCircleIcon, CheckIcon, SearchIcon } from '@lucide/vue';
import { useDebounce } from '@vueuse/core';
import { computed, defineAsyncComponent, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';

const LogoImageTab = defineAsyncComponent(() => import('./logo-image-tab.vue'));

const props = withDefaults(
  defineProps<{
    /** Current logo (null = none). Highlights the matching brand row and prefills the matching tab. */
    selection: LogoSelection | null;
    /** Seeds the search field so the panel opens already showing matches for the entity. */
    nameForSearch: string;
    tabs?: LogoTab[];
  }>(),
  { tabs: () => DEFAULT_LOGO_TABS },
);

const emit = defineEmits<{
  (e: 'select', value: LogoSelection): void;
}>();

const { t } = useI18n({ useScope: 'global' });

const selectedDomain = computed(() => (props.selection?.kind === 'brand' ? props.selection.domain : null));

// Without the token every brand pick renders as a monogram anyway, so the brand
// tab must not offer choices that cannot render.
const brandLogosAvailable = Boolean(config.logoDevToken);

const TAB_BY_KIND: Record<LogoSelection['kind'], LogoTab> = {
  brand: 'brand',
  monogram: 'letters',
  icon: 'icon',
  image: 'custom',
  'image-upload': 'custom',
};

// Panel re-mounts on each open, so an entity that already carries a logo lands
// on the tab that owns it.
const selectionTab = props.selection ? TAB_BY_KIND[props.selection.kind] : null;
const activeTab = ref<string>(
  selectionTab && props.tabs.includes(selectionTab)
    ? selectionTab
    : (props.tabs.find((tab) => tab !== 'brand' || brandLogosAvailable) ?? props.tabs[0]!),
);
const tabsGridStyle = computed(() => ({ gridTemplateColumns: `repeat(${props.tabs.length}, minmax(0, 1fr))` }));

const currentMonogram = props.selection?.kind === 'monogram' ? props.selection : null;
const currentIcon = props.selection?.kind === 'icon' ? props.selection : null;

// Brand search waits this long after the last keystroke before firing, so a
// fast typist produces one request per word rather than one per character.
const SEARCH_DEBOUNCE_MS = 300;

const searchQuery = ref(props.nameForSearch);
const debounced = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);

const trimmedQuery = computed(() => searchQuery.value.trim());
const debouncedQuery = computed(() => debounced.value.trim());
// True between a keystroke and the debounce settling – used to keep the panel in
// its "searching" state during that window instead of flashing "no results".
const isTyping = computed(() => trimmedQuery.value !== debouncedQuery.value);

const {
  results: brandResults,
  isFetching,
  isError,
} = useSearchBrandLogo({ q: debouncedQuery, enabled: brandLogosAvailable });

// A trimmed query that looks like a bare domain (has a dot, no spaces, no
// slashes – e.g. "amazon.com"). logo.dev always returns a 200 monogram for any
// domain, so the user can pick one directly even when the brand search misses.
const DOMAIN_SHAPE = /^[^\s/]+\.[^\s/]+$/;

const syntheticDomainResult = computed<BrandLogoSearchResult | null>(() => {
  const q = trimmedQuery.value;
  if (!DOMAIN_SHAPE.test(q)) return null;
  return {
    name: t('common.logo.useDomainDirectly', { domain: q }),
    domain: q,
    logoUrl: getServiceLogoUrl({ domain: q }),
  };
});

// The typed domain sits on top, followed by the brand-search hits with any
// duplicate of the synthetic domain removed so it never appears twice.
const displayedResults = computed<BrandLogoSearchResult[]>(() => {
  const synthetic = syntheticDomainResult.value;
  if (!synthetic) return brandResults.value;
  return [synthetic, ...brandResults.value.filter((result) => result.domain !== synthetic.domain)];
});

const hasResults = computed(() => displayedResults.value.length > 0);
// Spans the debounce gap and in-flight request, but only once the query is long enough to fire.
const isSearching = computed(
  () => trimmedQuery.value.length >= LOGO_SEARCH_MIN_QUERY_LENGTH && (isTyping.value || isFetching.value),
);

// A bare domain query yields the synthetic row, so the "type more" hint only
// applies to short, non-domain fragments.
const showTypePrompt = computed(
  () => !syntheticDomainResult.value && trimmedQuery.value.length < LOGO_SEARCH_MIN_QUERY_LENGTH,
);
// Skeleton only on first search; refetches keep existing rows visible to avoid flicker.
const showSkeleton = computed(() => isSearching.value && !hasResults.value);
// Checked before showNoResults so a failed query doesn't surface the "no brand matched" copy.
const showError = computed(() => isError.value && !isSearching.value);
const showNoResults = computed(
  () => !isError.value && !isSearching.value && !showTypePrompt.value && !hasResults.value,
);

const SKELETON_ROW_COUNT = 4;

function handlePick({ domain }: BrandLogoSearchResult) {
  emit('select', { kind: 'brand', domain });
}

function selectAllOnFocus(event: FocusEvent) {
  (event.target as HTMLInputElement).select();
}

// Both branches go through the clamp so the input can never open with a value
// the backend would reject.
const letters = ref(
  currentMonogram ? clampInitials({ value: currentMonogram.initials }) : deriveInitials({ name: props.nameForSearch }),
);
const fillColor = ref(currentMonogram?.color ?? currentIcon?.color ?? DEFAULT_MONOGRAM_COLOR);
const lettersInputId = useId();

const trimmedLetters = computed(() => letters.value.trim());

function handleLettersInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const clamped = clampInitials({ value: input.value });
  // Vue skips the DOM patch when the clamp leaves the model unchanged, so the
  // over-limit keystroke has to be written back by hand.
  if (input.value !== clamped) input.value = clamped;
  letters.value = clamped;
}

function applyMonogram() {
  if (!trimmedLetters.value) return;
  emit('select', { kind: 'monogram', initials: trimmedLetters.value, color: fillColor.value });
}

const iconName = ref(currentIcon?.icon ?? '');

function applyIcon() {
  if (!iconName.value) return;
  emit('select', { kind: 'icon', icon: iconName.value, color: fillColor.value });
}
</script>

<template>
  <Tabs v-model="activeTab" class="flex flex-col">
    <div class="border-input border-b p-2">
      <TabsList class="grid w-full" :style="tabsGridStyle">
        <TabsTrigger v-if="tabs.includes('brand')" value="brand" data-test="logo-tab-brand">
          {{ $t('common.logo.tabs.brand') }}
        </TabsTrigger>
        <TabsTrigger v-if="tabs.includes('letters')" value="letters" data-test="logo-tab-letters">
          {{ $t('common.logo.tabs.letters') }}
        </TabsTrigger>
        <TabsTrigger v-if="tabs.includes('icon')" value="icon" data-test="logo-tab-icon">
          {{ $t('common.logo.tabs.icon') }}
        </TabsTrigger>
        <TabsTrigger v-if="tabs.includes('custom')" value="custom" data-test="logo-tab-custom">
          {{ $t('common.logo.tabs.custom') }}
        </TabsTrigger>
      </TabsList>
    </div>

    <TabsContent v-if="tabs.includes('brand')" value="brand" class="mt-0 flex flex-col">
      <div
        v-if="!brandLogosAvailable"
        class="text-muted-foreground flex flex-col items-center gap-1.5 px-4 py-6 text-center"
        data-test="logo-brand-unavailable"
      >
        <AlertCircleIcon class="size-5" />
        <p class="text-sm">{{ $t('common.logo.brandNotConfigured') }}</p>
        <Button
          type="button"
          variant="link"
          size="sm"
          data-test="logo-brand-unavailable-letters"
          @click="activeTab = 'letters'"
        >
          {{ $t('common.logo.noResultsLettersHint') }}
        </Button>
      </div>

      <template v-else>
        <div class="border-input border-b p-2">
          <div class="relative">
            <SearchIcon class="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2" />
            <!-- NOTE: raw <input> used here instead of InputField because this search
               box lives inside a popover panel – no label, no error display, needs
               a custom leading icon slot and a @focus handler that InputField does
               not natively support without a full wrapper rewrite. -->
            <input
              v-model="searchQuery"
              type="text"
              class="border-input bg-input-background focus-visible:ring-ring h-9 w-full rounded-md border pr-2 pl-8 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
              :placeholder="$t('common.logo.searchPlaceholder')"
              data-test="logo-search-input"
              @focus="selectAllOnFocus"
            />
          </div>
        </div>

        <!-- Prompt: query still too short to search and not a domain. -->
        <div
          v-if="showTypePrompt"
          class="text-muted-foreground flex flex-col items-center gap-1.5 px-4 py-6 text-center"
        >
          <SearchIcon class="size-5" />
          <p class="text-sm">{{ $t('common.logo.searchHint') }}</p>
        </div>

        <!-- First-search skeletons. -->
        <div v-else-if="showSkeleton" class="flex flex-col gap-1 p-1.5">
          <div v-for="row in SKELETON_ROW_COUNT" :key="row" class="flex items-center gap-3 px-3 py-2">
            <div class="bg-muted size-8 shrink-0 animate-pulse rounded-lg" />
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <div class="bg-muted h-3 w-2/5 animate-pulse rounded" />
              <div class="bg-muted h-2.5 w-3/5 animate-pulse rounded" />
            </div>
          </div>
        </div>

        <!-- Error state: distinct from no-results so the user knows to retry, not rephrase. -->
        <div
          v-else-if="showError"
          class="text-muted-foreground flex flex-col items-center gap-1.5 px-4 py-6 text-center"
        >
          <AlertCircleIcon class="text-destructive-text size-5" />
          <p class="text-sm">{{ $t('common.logo.searchError') }}</p>
        </div>

        <!-- No brand matched the search – point at the letters fallback. -->
        <div
          v-else-if="showNoResults"
          class="text-muted-foreground flex flex-col items-center gap-1.5 px-4 py-6 text-center"
        >
          <SearchIcon class="size-5" />
          <p class="text-sm">{{ $t('common.logo.noResults') }}</p>
          <Button
            type="button"
            variant="link"
            size="sm"
            data-test="logo-no-results-letters"
            @click="activeTab = 'letters'"
          >
            {{ $t('common.logo.noResultsLettersHint') }}
          </Button>
        </div>

        <ScrollArea v-else class="max-h-72">
          <div class="flex flex-col gap-1 p-1.5" role="listbox">
            <Button
              v-for="result in displayedResults"
              :key="result.domain"
              variant="ghost"
              role="option"
              :aria-selected="result.domain === selectedDomain"
              :class="
                cn(
                  'h-auto w-full justify-start gap-3 rounded-md px-3 py-2 text-left',
                  result.domain === selectedDomain && 'bg-primary/10 hover:bg-primary/15',
                )
              "
              @click="handlePick(result)"
            >
              <AsyncLogo :url="result.logoUrl" :alt="result.name" class="size-8 shrink-0 rounded-lg" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ result.name }}</p>
                <p class="text-muted-foreground truncate text-xs">{{ result.domain }}</p>
              </div>
              <CheckIcon v-if="result.domain === selectedDomain" class="text-primary-text size-4 shrink-0" />
            </Button>
          </div>
        </ScrollArea>
      </template>
    </TabsContent>

    <TabsContent v-if="tabs.includes('letters')" value="letters" class="mt-0">
      <div class="flex flex-col gap-4 p-3">
        <div class="flex items-center gap-3">
          <BrandLogo
            :domain="null"
            :name="nameForSearch"
            :initials="trimmedLetters || null"
            :color="fillColor"
            class="size-12 text-lg"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label :for="lettersInputId" class="text-xs font-medium">{{ $t('common.logo.lettersLabel') }}</Label>
            <!-- NOTE: raw <input> instead of InputField – the two-grapheme clamp
                 writes the trimmed value straight back to the DOM node, which
                 InputField's value binding does not expose. -->
            <input
              :id="lettersInputId"
              :value="letters"
              type="text"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              class="border-input bg-input-background focus-visible:ring-ring h-9 w-full rounded-md border px-2 text-sm uppercase focus-visible:ring-2 focus-visible:outline-hidden"
              :placeholder="$t('common.logo.lettersPlaceholder')"
              data-test="logo-letters-input"
              @input="handleLettersInput"
            />
            <p class="text-muted-foreground text-xs">{{ $t('common.logo.lettersHint') }}</p>
          </div>
        </div>

        <LogoColorPicker v-model="fillColor" />

        <Button type="button" :disabled="!trimmedLetters" data-test="logo-letters-apply" @click="applyMonogram">
          {{ $t('common.actions.apply') }}
        </Button>
      </div>
    </TabsContent>

    <TabsContent v-if="tabs.includes('icon')" value="icon" class="mt-0">
      <div class="flex flex-col gap-4 p-3">
        <div class="flex items-start gap-3">
          <BrandLogo
            :domain="null"
            :name="nameForSearch"
            :icon="iconName || null"
            :color="fillColor"
            class="size-12 shrink-0 text-lg"
          />
          <div class="min-w-0 flex-1">
            <IconPickerDropdown v-model="iconName" />
          </div>
        </div>

        <LogoColorPicker v-model="fillColor" />

        <Button type="button" :disabled="!iconName" data-test="logo-icon-apply" @click="applyIcon">
          {{ $t('common.actions.apply') }}
        </Button>
      </div>
    </TabsContent>

    <TabsContent v-if="tabs.includes('custom')" value="custom" class="mt-0">
      <LogoImageTab :selection="selection" :name="nameForSearch" @select="emit('select', $event)" />
    </TabsContent>
  </Tabs>
</template>
