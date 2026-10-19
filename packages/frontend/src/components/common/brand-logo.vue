<script setup lang="ts">
import { getLogoImageUrl, getServiceLogoUrl } from '@/common/utils/logo-url';
import { getMonogramTextColor } from '@/common/utils/monogram-color';
import AsyncLogo from '@/components/common/async-logo.vue';
import { DEFAULT_MONOGRAM_COLOR } from '@/components/common/logo-selection';
import { cn } from '@/lib/utils';
import { Icon } from '@iconify/vue';
import { computed, useAttrs } from 'vue';

defineOptions({ inheritAttrs: false });

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// cqmin-based font sizes so the monogram scales with the tile (consumers render
// anywhere from size-4 to size-12). Two graphemes need a smaller share of the
// tile than one, otherwise emoji pairs overflow the smallest tiles.
const SINGLE_GRAPHEME_FONT = '52cqmin';
const DOUBLE_GRAPHEME_FONT = '40cqmin';
const ICON_SIZE = '60cqmin';

const props = defineProps<{
  /** Resolved brand domain (e.g. "amazon.com"). Null = show monogram. */
  domain: string | null;
  /** Entity name – used to derive the monogram letter. */
  name: string;
  /** Custom monogram letters. Takes priority over `domain`. */
  initials?: string | null;
  /** Iconify name without the `fluent:` prefix, drawn on the `color` fill. */
  icon?: string | null;
  /** '#rrggbb' fill behind `initials` or `icon`. Null falls back to the default violet. */
  color?: string | null;
  /** Uploaded image served by the API. Takes priority over every other prop. */
  imageId?: string | null;
  /** Freshly cropped image not uploaded yet. */
  imageDataUrl?: string | null;
}>();

const attrs = useAttrs();

const customInitials = computed(() => props.initials?.trim() || null);
const customIcon = computed(() => (customInitials.value ? null : props.icon || null));

const imageUrl = computed(() => {
  if (props.imageDataUrl) return props.imageDataUrl;
  return props.imageId ? getLogoImageUrl({ id: props.imageId }) : null;
});

const logoUrl = computed(() => {
  if (imageUrl.value) return imageUrl.value;
  if (customInitials.value || customIcon.value || !props.domain) return null;
  return getServiceLogoUrl({ domain: props.domain });
});

const solidFill = computed(() => {
  if (!customInitials.value && !customIcon.value) return null;
  const color = props.color ?? DEFAULT_MONOGRAM_COLOR;
  return { backgroundColor: color, color: getMonogramTextColor({ hex: color }) };
});

const monogramText = computed(() => customInitials.value ?? (props.name.trim().charAt(0).toUpperCase() || '·'));

// Custom monograms and icons always get a solid fill (default violet when no
// color was stored) with dark or white content picked by fill brightness. Font
// size scales with the tile via container-query units, sized down for two
// graphemes so emoji pairs stay inside the smallest tiles.
const monogramStyle = computed(() => {
  const graphemeCount = [...graphemeSegmenter.segment(monogramText.value)].length;
  return {
    fontSize: graphemeCount <= 1 ? SINGLE_GRAPHEME_FONT : DOUBLE_GRAPHEME_FONT,
    ...solidFill.value,
  };
});

// The 15% primary tint marks only the auto-derived first-letter placeholder.
const monogramClass = computed(() =>
  cn(
    'absolute inset-0 flex items-center justify-center overflow-hidden rounded-[inherit] leading-none font-bold uppercase whitespace-nowrap',
    !solidFill.value && 'bg-primary/15 text-primary-text',
  ),
);

// One radius governs the whole stack: the container sets it, the monogram and
// the logo frame inherit it via `rounded-[inherit]`, and the ring traces the
// same corners. The logo image, its background fill, and any control a consumer
// overlays (e.g. a detail page's edit button) must share a single radius –
// otherwise the smaller-radius layer leaves a visible sliver of the larger one
// at each corner. The default is overridable via the pass-through class (e.g.
// `rounded-md` at small sizes).
//
// `container-type: size` lets the monogram font resolve cqmin against the tile.
// Size containment needs explicit dimensions, which is safe because every
// consumer passes a `size-*` class.
const containerClass = computed(() =>
  cn('relative shrink-0 rounded-lg ring-1 ring-primary/15 [container-type:size]', attrs.class as string | undefined),
);
</script>

<template>
  <div :class="containerClass">
    <div
      v-if="customIcon"
      class="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[inherit]"
      :style="solidFill ?? undefined"
      aria-hidden="true"
    >
      <Icon :icon="`fluent:${customIcon}`" :style="{ width: ICON_SIZE, height: ICON_SIZE }" />
    </div>

    <!-- Monogram: base layer, visible when no logo is resolved or still loading. -->
    <div v-else :class="monogramClass" :style="monogramStyle" aria-hidden="true">
      {{ monogramText }}
    </div>

    <!-- AsyncLogo stacks above the monogram; renders nothing on null/error so the monogram shows through. -->
    <AsyncLogo v-if="logoUrl" :url="logoUrl" :alt="name" class="absolute inset-0 size-full rounded-[inherit]" />
  </div>
</template>
