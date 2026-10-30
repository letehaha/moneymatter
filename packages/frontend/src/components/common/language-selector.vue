<template>
  <Popover.Popover>
    <Popover.PopoverTrigger as-child>
      <Button :variant="variant" :size="showLabel ? 'default' : 'icon'" :class="buttonClass">
        <template v-if="showLabel">
          <span>{{ currentLocaleNative }}</span>
          <img :src="currentFlagSrc" :alt="currentLocaleNative" class="h-4 w-5.5 rounded-sm object-cover" />
        </template>
        <template v-else>
          <img :src="currentFlagSrc" :alt="currentLocaleNative" class="h-4 w-5.5 rounded-sm object-cover" />
        </template>
      </Button>
    </Popover.PopoverTrigger>
    <Popover.PopoverContent class="w-56" align="end">
      <div class="space-y-1">
        <div v-if="showHeader" class="mb-2 text-sm font-medium">
          {{ $t('header.language') }}
        </div>
        <button
          v-for="locale in availableLocales"
          :key="locale.value"
          class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
          :class="{
            'bg-accent': currentLocale === locale.value,
          }"
          @click="handleLocaleChange(locale.value)"
        >
          <img :src="locale.flagSrc" :alt="locale.native" class="h-4 w-5.5 rounded-sm object-cover" />
          <span>{{ locale.native }}</span>
        </button>
      </div>
    </Popover.PopoverContent>
  </Popover.Popover>
</template>

<script setup lang="ts">
import { api } from '@/api';
import Button from '@/components/lib/ui/button/Button.vue';
import * as Popover from '@/components/lib/ui/popover';
import { getCurrentLocale, setLocale } from '@/i18n';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from '@bt/shared/i18n/locales';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Button variant */
    variant?: 'default' | 'secondary' | 'outline' | 'ghost';
    /** Additional classes for the button */
    buttonClass?: string;
    /** Whether to show the "Language" header in popover */
    showHeader?: boolean;
    /** Whether to show language name alongside flag in button */
    showLabel?: boolean;
    /** Whether to persist locale to backend (requires authenticated user) */
    persistToBackend?: boolean;
  }>(),
  {
    variant: 'outline',
    buttonClass: '',
    showHeader: false,
    showLabel: false,
    persistToBackend: false,
  },
);

const queryClient = useQueryClient();

const currentLocale = ref<SupportedLocale>(getCurrentLocale() as SupportedLocale);

const FLAG_SRCS: Record<SupportedLocale, string> = {
  [SUPPORTED_LOCALES.ENGLISH]: '/img/flags/gb.svg',
  [SUPPORTED_LOCALES.UKRAINIAN]: '/img/flags/ua.svg',
  [SUPPORTED_LOCALES.SPANISH]: '/img/flags/es.png',
  [SUPPORTED_LOCALES.INDONESIAN]: '/img/flags/id.svg',
  [SUPPORTED_LOCALES.RUSSIAN]: '/img/flags/ru.svg',
  [SUPPORTED_LOCALES.SLOVAK]: '/img/flags/sk.svg',
  [SUPPORTED_LOCALES.GERMAN]: '/img/flags/de.svg',
  [SUPPORTED_LOCALES.FRENCH]: '/img/flags/fr.svg',
  [SUPPORTED_LOCALES.BRAZILIAN_PORTUGUESE]: '/img/flags/br.svg',
};

const currentFlagSrc = computed(() => FLAG_SRCS[currentLocale.value]);
const currentLocaleNative = computed(() => LOCALE_NAMES[currentLocale.value].native);

const availableLocales = Object.values(SUPPORTED_LOCALES).map((value) => ({
  value,
  native: LOCALE_NAMES[value].native,
  flagSrc: FLAG_SRCS[value],
}));

async function handleLocaleChange(locale: SupportedLocale) {
  const previousLocale = currentLocale.value;
  currentLocale.value = locale;
  await setLocale(locale);

  // Track language change
  if (previousLocale !== locale) {
    trackAnalyticsEvent({
      event: 'language_changed',
      properties: {
        from_locale: previousLocale,
        to_locale: locale,
      },
    });
  }

  // Optionally persist to backend for authenticated users
  if (props.persistToBackend) {
    try {
      const currentSettings = await api.get('/user/settings');
      await api.put('/user/settings', {
        ...currentSettings,
        locale,
      });
      queryClient.invalidateQueries({ queryKey: ['user', 'settings'] });
    } catch {
      // Silently fail - localStorage is already updated
      console.error('Failed to persist locale to backend');
    }
  }
}
</script>
