<script lang="ts" setup>
import { COORDINATE_PRECISION } from '@/common/utils/coordinates';
import { type PlaceResult, searchPlaces } from '@/common/utils/nominatim';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { cn } from '@/lib/utils';
import { Loader2Icon, LocateIcon, SearchIcon, TriangleAlertIcon, XIcon } from '@lucide/vue';
import { watchDebounced } from '@vueuse/core';
import type { TransactionLocation } from '@bt/shared/types';
import type * as LeafletNs from 'leaflet';
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useMapPickerSetting } from '../composables/use-map-picker-setting';
import { useReverseGeocodedLabel } from '../composables/use-reverse-geocoded-label';

const props = defineProps<{
  latitude?: number | null;
  longitude?: number | null;
}>();

const emit = defineEmits<{
  select: [payload: { latitude: number; longitude: number; label: string | null }];
}>();

const isOpen = defineModel<boolean>('open', { default: false });

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const FALLBACK_CENTER: LeafletNs.LatLngTuple = [50.4501, 30.5234];
const FALLBACK_ZOOM = 5;
const FOCUSED_ZOOM = 15;
const SEARCH_RESULT_ZOOM = 16;
const MAX_TILE_ZOOM = 19;
const SEARCH_DEBOUNCE_MS = 400;
const REVERSE_DEBOUNCE_MS = 600;
const MIN_SEARCH_LENGTH = 3;
const INVALIDATE_SIZE_DELAY_MS = 250;
const MAP_SIZE_CLASS = 'h-[46dvh] min-h-[260px] w-full sm:h-[340px]';

const MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M12 22.5C12 22.3 4 15.4 4 10a8 8 0 1 1 16 0c0 5.4-8 12.3-8 12.5Z"/><circle cx="12" cy="10" r="3" fill="var(--background)"/></svg>`;

const { t, locale } = useI18n();
const { addErrorNotification } = useNotificationCenter();
const { enabled, setEnabled, isUpdating } = useMapPickerSetting();

let leaflet: typeof LeafletNs | null = null;
let map: LeafletNs.Map | null = null;
let marker: LeafletNs.Marker | null = null;

const mapContainer = ref<HTMLElement | null>(null);
const leafletStatus = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle');
const position = ref<TransactionLocation | null>(null);
const isLocating = ref(false);

const { label, isResolving, setKnownLabel } = useReverseGeocodedLabel({
  latitude: computed(() => position.value?.latitude ?? null),
  longitude: computed(() => position.value?.longitude ?? null),
  enabled,
  debounceMs: REVERSE_DEBOUNCE_MS,
});

const bodyState = computed(() => {
  if (!enabled.value) return 'consent';
  if (leafletStatus.value === 'failed') return 'failed';
  if (leafletStatus.value === 'ready') return 'map';
  return 'loading';
});

const renderMarker = ({ latitude, longitude }: TransactionLocation) => {
  if (!leaflet || !map) return;

  if (marker) {
    marker.setLatLng([latitude, longitude]);
    return;
  }

  marker = leaflet
    .marker([latitude, longitude], {
      draggable: true,
      icon: leaflet.divIcon({
        className: 'text-primary-text drop-shadow-md',
        html: MARKER_SVG,
        iconSize: [30, 30],
        iconAnchor: [15, 29],
      }),
    })
    .addTo(map);

  marker.on('dragend', () => {
    const { lat, lng } = marker!.getLatLng();
    pickPosition({ latitude: lat, longitude: lng });
  });
};

const pickPosition = ({ latitude, longitude }: TransactionLocation) => {
  position.value = { latitude, longitude };
  renderMarker({ latitude, longitude });
};

const goToBrowserLocation = () => {
  if (!navigator.geolocation) {
    addErrorNotification(t('dialogs.manageTransaction.form.location.unsupported'));
    return;
  }

  isLocating.value = true;
  const target = map;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      if (map !== target) return;
      isLocating.value = false;
      map?.setView([coords.latitude, coords.longitude], FOCUSED_ZOOM);
      pickPosition({ latitude: coords.latitude, longitude: coords.longitude });
    },
    (error) => {
      if (map !== target) return;
      isLocating.value = false;
      const key = error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable';
      addErrorNotification(t(`dialogs.manageTransaction.form.location.${key}`));
    },
    { enableHighAccuracy: true, timeout: 10_000 },
  );
};

const createMap = () => {
  if (!leaflet || !mapContainer.value || map) return;

  const start = position.value;
  map = leaflet
    .map(mapContainer.value)
    .setView(start ? [start.latitude, start.longitude] : FALLBACK_CENTER, start ? FOCUSED_ZOOM : FALLBACK_ZOOM);

  leaflet
    .tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: MAX_TILE_ZOOM,
    })
    .addTo(map);
  map.on('click', ({ latlng }: LeafletNs.LeafletMouseEvent) =>
    pickPosition({ latitude: latlng.lat, longitude: latlng.lng }),
  );

  if (start) renderMarker(start);

  // The dialog is still animating open here, so the container has no final size yet and the
  // tiles would paint grey without a resize pass once it settles.
  setTimeout(() => map?.invalidateSize(), INVALIDATE_SIZE_DELAY_MS);
};

const loadLeaflet = async () => {
  leafletStatus.value = 'loading';
  if (!leaflet) {
    try {
      const [module] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
      // Leaflet 1.9.4 ships a UMD entry, so Vite's interop hangs the namespace off `default`.
      const withInterop = module as typeof LeafletNs & {
        default?: typeof LeafletNs;
      };
      leaflet = withInterop.default ?? withInterop;
    } catch {
      leafletStatus.value = 'failed';
      return;
    }
  }

  leafletStatus.value = 'ready';
  await nextTick();
  createMap();
};

const startMap = () => {
  if (enabled.value && leafletStatus.value === 'idle') void loadLeaflet();
};

const destroyMap = () => {
  map?.remove();
  map = null;
  marker = null;
  leafletStatus.value = 'idle';
};

const searchQuery = ref('');
const searchResults = ref<PlaceResult[]>([]);
const searchInput = ref<InstanceType<typeof InputField> | null>(null);
const isSearching = ref(false);
const hasSearchFailed = ref(false);
const isResultsOpen = ref(false);
const highlightedIndex = ref(-1);
let searchAbortController: AbortController | undefined;

const resetSearch = () => {
  searchAbortController?.abort();
  searchAbortController = undefined;
  searchQuery.value = '';
  searchResults.value = [];
  isSearching.value = false;
  hasSearchFailed.value = false;
  isResultsOpen.value = false;
  highlightedIndex.value = -1;
};

watchDebounced(
  searchQuery,
  async (query) => {
    const trimmed = query.trim();
    searchAbortController?.abort();

    if (trimmed.length < MIN_SEARCH_LENGTH) {
      isSearching.value = false;
      searchResults.value = [];
      hasSearchFailed.value = false;
      isResultsOpen.value = false;
      return;
    }

    searchAbortController = new AbortController();
    const { signal } = searchAbortController;
    hasSearchFailed.value = false;
    isSearching.value = true;

    try {
      const places = await searchPlaces({
        query: trimmed,
        signal,
        language: locale.value,
      });
      if (signal.aborted) return;
      searchResults.value = places;
      highlightedIndex.value = places.length ? 0 : -1;
    } catch {
      if (signal.aborted) return;
      searchResults.value = [];
      hasSearchFailed.value = true;
    } finally {
      if (!signal.aborted) isSearching.value = false;
    }
    isResultsOpen.value = true;
  },
  { debounce: SEARCH_DEBOUNCE_MS },
);

const applySearchResult = ({ place }: { place: PlaceResult }) => {
  pickPosition({ latitude: place.latitude, longitude: place.longitude });
  setKnownLabel({ latitude: place.latitude, longitude: place.longitude, label: place.label });
  map?.setView([place.latitude, place.longitude], SEARCH_RESULT_ZOOM);
  isResultsOpen.value = false;
};

const clearSearch = () => {
  resetSearch();
  searchInput.value?.focus();
};

const moveHighlight = ({ step }: { step: number }) => {
  if (!isResultsOpen.value || !searchResults.value.length) return;
  const count = searchResults.value.length;
  highlightedIndex.value = (highlightedIndex.value + step + count) % count;
};

const handleSearchEnter = () => {
  const place = searchResults.value[highlightedIndex.value];
  if (place) applySearchResult({ place });
};

const handleSearchEscape = (event: KeyboardEvent) => {
  if (!isResultsOpen.value) return;
  event.stopPropagation();
  isResultsOpen.value = false;
};

const enableMapPicker = async () => {
  try {
    await setEnabled({ value: true });
  } catch {
    addErrorNotification(t('dialogs.manageTransaction.form.location.picker.consent.failed'));
  }
};

const formattedCoordinates = computed(() => {
  if (!position.value) return '';
  const { latitude, longitude } = position.value;
  return `${latitude.toFixed(COORDINATE_PRECISION)}, ${longitude.toFixed(COORDINATE_PRECISION)}`;
});

const confirm = () => {
  if (!position.value) return;
  emit('select', { ...position.value, label: label.value });
  isOpen.value = false;
};

watch(isOpen, (open) => {
  if (!open) {
    destroyMap();
    resetSearch();
    return;
  }

  position.value =
    props.latitude != null && props.longitude != null ? { latitude: props.latitude, longitude: props.longitude } : null;
  startMap();
});

// The map div unmounts under the consent state, so the instance has to go with it.
watch(enabled, (isEnabled) => {
  if (!isEnabled) {
    destroyMap();
    return;
  }
  if (isOpen.value) startMap();
});

onUnmounted(() => {
  destroyMap();
  searchAbortController?.abort();
});
</script>

<template>
  <ResponsiveDialog
    v-model:open="isOpen"
    no-internal-scroll
    dialog-content-class="sm:max-w-xl"
    drawer-content-class="max-h-[92dvh]"
  >
    <template #title>{{ $t('dialogs.manageTransaction.form.location.picker.title') }}</template>

    <div v-if="bodyState === 'consent'" class="space-y-3 py-2">
      <p class="text-sm font-medium">
        {{ $t('dialogs.manageTransaction.form.location.picker.consent.title') }}
      </p>
      <p class="text-muted-foreground text-sm">
        {{ $t('dialogs.manageTransaction.form.location.picker.consent.description') }}
      </p>
      <Button type="button" :disabled="isUpdating" @click="enableMapPicker">
        {{ $t('dialogs.manageTransaction.form.location.picker.consent.enable') }}
      </Button>
    </div>

    <div
      v-else-if="bodyState === 'failed'"
      :class="cn(MAP_SIZE_CLASS, 'flex flex-col items-center justify-center gap-3 text-center')"
    >
      <TriangleAlertIcon class="text-muted-foreground size-6" />
      <p class="text-muted-foreground text-sm">
        {{ $t('dialogs.manageTransaction.form.location.picker.loadFailed') }}
      </p>
      <Button type="button" variant="outline" size="sm" @click="loadLeaflet">
        {{ $t('dialogs.manageTransaction.form.location.picker.retry') }}
      </Button>
    </div>

    <!-- Panning the map must not drag the mobile drawer shut. -->
    <div v-else data-vaul-no-drag class="relative">
      <div v-if="bodyState === 'loading'" :class="cn(MAP_SIZE_CLASS, 'bg-muted animate-pulse rounded-xl')" />
      <div v-else ref="mapContainer" :class="cn(MAP_SIZE_CLASS, 'overflow-hidden rounded-xl')" />

      <div
        class="absolute top-3 left-14 z-1001 w-[min(20rem,calc(100%-4.5rem))]"
        @focusin="isResultsOpen = searchResults.length > 0 || hasSearchFailed"
        @keydown.down.prevent="moveHighlight({ step: 1 })"
        @keydown.up.prevent="moveHighlight({ step: -1 })"
        @keydown.enter.prevent="handleSearchEnter"
        @keydown.esc="handleSearchEscape"
      >
        <InputField
          ref="searchInput"
          v-model="searchQuery"
          :disabled="bodyState === 'loading'"
          :placeholder="$t('dialogs.manageTransaction.form.location.picker.searchPlaceholder')"
          class="[&_input]:bg-card [&_input]:shadow-md"
          trailing-icon-css-class="pointer-events-none px-2"
        >
          <template #iconLeading>
            <SearchIcon class="text-muted-foreground size-4" />
          </template>
          <template v-if="isSearching || searchQuery" #iconTrailing>
            <Loader2Icon v-if="isSearching" class="text-muted-foreground size-4 animate-spin" />
            <DesktopOnlyTooltip v-else :content="$t('common.actions.clear')">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="text-muted-foreground hover:text-foreground pointer-events-auto"
                :aria-label="$t('common.actions.clear')"
                @click="clearSearch"
              >
                <XIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
          </template>
        </InputField>

        <div
          v-if="isResultsOpen"
          id="location-search-results"
          role="listbox"
          class="bg-popover text-popover-foreground mt-1 overflow-hidden rounded-md border shadow-md"
        >
          <p v-if="hasSearchFailed" class="text-muted-foreground px-3 py-2 text-xs">
            {{ $t('dialogs.manageTransaction.form.location.picker.searchFailed') }}
          </p>
          <p v-else-if="!searchResults.length" class="text-muted-foreground px-3 py-2 text-xs">
            {{ $t('dialogs.manageTransaction.form.location.picker.noResults') }}
          </p>
          <Button
            v-for="(place, index) in searchResults"
            :id="`location-search-option-${index}`"
            :key="`${place.latitude}-${place.longitude}-${index}`"
            type="button"
            role="option"
            :aria-selected="index === highlightedIndex"
            variant="ghost"
            :class="
              cn(
                'h-auto w-full flex-col items-start gap-0 rounded-none px-3 py-2 text-left',
                index === highlightedIndex && 'bg-accent hover:bg-accent',
              )
            "
            @mouseenter="highlightedIndex = index"
            @click="applySearchResult({ place })"
          >
            <span class="w-full truncate text-sm font-medium">{{ place.label }}</span>
            <span class="text-muted-foreground w-full truncate text-xs">{{ place.secondary }}</span>
          </Button>
        </div>
      </div>

      <DesktopOnlyTooltip
        v-if="bodyState === 'map'"
        :content="$t('dialogs.manageTransaction.form.location.useCurrent')"
      >
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          class="bg-card absolute right-3 bottom-8 z-1001 shadow-md"
          :disabled="isLocating"
          :aria-label="$t('dialogs.manageTransaction.form.location.useCurrent')"
          @click="goToBrowserLocation"
        >
          <LocateIcon class="size-4" />
        </Button>
      </DesktopOnlyTooltip>
    </div>

    <template #footer>
      <div class="flex w-full items-start justify-between gap-3">
        <div class="min-w-0 flex-1 text-left">
          <p class="text-muted-foreground line-clamp-2 text-sm wrap-break-word">
            {{ isResolving ? '—' : (label ?? '—') }}
          </p>
          <p class="text-muted-foreground text-xs tabular-nums">
            {{ formattedCoordinates }}
          </p>
        </div>
        <Button type="button" class="shrink-0" :disabled="!position" @click="confirm">
          {{ $t('dialogs.manageTransaction.form.location.picker.confirm') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>

<style>
/* Leaflet paints a white box with a grey border behind every divIcon. */
.leaflet-div-icon {
  background: transparent;
  border: 0;
}

.dark .leaflet-tile-pane {
  filter: invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.9);
}
</style>
