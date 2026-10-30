<template>
  <Card class="max-w-4xl">
    <CardHeader class="border-b">
      <h2 class="mb-2 text-2xl font-semibold">{{ $t('settings.language.title') }}</h2>
      <p class="text-sm opacity-80">{{ $t('settings.language.description') }}</p>
    </CardHeader>

    <CardContent class="mt-6 space-y-6">
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="locale in maintainedLocales"
          :key="locale.value"
          :variant="currentLocale === locale.value ? 'default' : 'outline'"
          size="sm"
          :disabled="isUpdating"
          @click="handleLocaleChange(locale.value)"
        >
          <img :src="locale.flagSrc" :alt="locale.native" class="h-4 w-5.5 rounded-sm object-cover" />
          <span>{{ locale.native }}</span>
        </Button>
      </div>

      <div v-if="communityLocales.length" class="space-y-2.5">
        <h3 class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          {{ $t('settings.language.community.title') }}
        </h3>
        <div class="flex flex-wrap gap-2">
          <Button
            v-for="locale in communityLocales"
            :key="locale.value"
            :variant="currentLocale === locale.value ? 'default' : 'outline'"
            size="sm"
            :disabled="isUpdating"
            @click="handleLocaleChange(locale.value)"
          >
            <img :src="locale.flagSrc" :alt="locale.native" class="h-4 w-5.5 rounded-sm object-cover" />
            <span>{{ locale.native }}</span>
          </Button>
        </div>
        <p class="text-muted-foreground max-w-prose text-[13px]">{{ $t('settings.language.community.hint') }}</p>
      </div>

      <div class="bg-muted/40 @container grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border p-4">
        <LanguagesIcon class="text-primary-text mt-0.5 size-5 shrink-0" />

        <h3 class="text-sm font-medium">{{ $t('settings.language.contribute.title') }}</h3>

        <p class="text-muted-foreground col-span-2 text-sm @min-[400px]:col-span-1 @min-[400px]:col-start-2">
          {{ $t('settings.language.contribute.description') }}
        </p>

        <i18n-t
          keypath="settings.language.contribute.requestNote"
          tag="p"
          class="text-muted-foreground col-span-2 mt-2 text-sm @min-[400px]:col-span-1 @min-[400px]:col-start-2"
        >
          <template #boardLink>
            <a
              :href="EXTERNAL_URLS.featurebaseRoadmap"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium underline underline-offset-2 hover:no-underline"
              @click="handleRequestBoardClick"
            >
              {{ $t('settings.language.contribute.requestNoteLink') }}
            </a>
          </template>
        </i18n-t>

        <div class="col-span-2 mt-2 @min-[400px]:col-span-1 @min-[400px]:col-start-2">
          <Button
            as="a"
            :href="EXTERNAL_URLS.crowdinProject"
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="sm"
            @click="handleContributeClick"
          >
            {{ $t('settings.language.contribute.action') }}
            <ExternalLinkIcon class="size-4" />
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import Button from '@/components/lib/ui/button/Button.vue';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { getCurrentLocale, setLocale } from '@/i18n';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { EXTERNAL_URLS } from '@bt/shared/const/external-urls';
import { COMMUNITY_LOCALES, LOCALE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from '@bt/shared/i18n/locales';
import { ExternalLinkIcon, LanguagesIcon } from '@lucide/vue';
import { ref } from 'vue';

const { data: userSettings, mutateAsync, isUpdating } = useUserSettings();

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

const currentLocale = ref<SupportedLocale>(getCurrentLocale() as SupportedLocale);

const availableLocales = Object.values(SUPPORTED_LOCALES).map((value) => ({
  value,
  native: LOCALE_NAMES[value].native,
  flagSrc: FLAG_SRCS[value],
}));
const maintainedLocales = availableLocales.filter((locale) => !COMMUNITY_LOCALES.has(locale.value));
const communityLocales = availableLocales.filter((locale) => COMMUNITY_LOCALES.has(locale.value));

const handleContributeClick = () => {
  trackAnalyticsEvent({
    event: 'crowdin_contribute_clicked',
    properties: { current_locale: currentLocale.value },
  });
};

const handleRequestBoardClick = () => {
  trackAnalyticsEvent({
    event: 'language_request_board_clicked',
    properties: { current_locale: currentLocale.value },
  });
};

const handleLocaleChange = async (locale: SupportedLocale) => {
  const previousLocale = currentLocale.value;
  if (previousLocale === locale) return;

  currentLocale.value = locale;
  await setLocale(locale);

  trackAnalyticsEvent({
    event: 'language_changed',
    properties: { from_locale: previousLocale, to_locale: locale },
  });

  try {
    await mutateAsync({ ...userSettings.value, locale });
  } catch {
    // localStorage is already updated by setLocale; backend persistence is best-effort
    console.error('Failed to persist locale to backend');
  }
};
</script>
