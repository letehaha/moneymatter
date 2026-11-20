<template>
  <div class="flex max-w-2xl flex-col gap-8">
    <p class="text-sm">
      <DocsLink path="/import/other-import-sources/#which-importer-to-use">
        {{ $t('settings.dataManagement.import.whichImporterHint') }}
      </DocsLink>
    </p>

    <section v-for="group in groups" :key="group.id" class="flex flex-col gap-3">
      <span class="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        {{ $t(`settings.dataManagement.import.groups.${group.id}`) }}
      </span>

      <div class="divide-border divide-y overflow-hidden rounded-lg border">
        <DataSourceRow
          v-for="source in group.sources"
          :key="source.id"
          :icon="source.icon"
          :icon-src="source.iconSrc"
          :title="$t(`settings.dataManagement.${source.id}.title`)"
          :description="$t(`settings.dataManagement.${source.id}.listDescription`)"
          :accent="source.accent"
          :badge="source.badge ? $t('settings.dataManagement.textSource.aiBadge') : undefined"
          :to="source.to"
        />

        <DataSourceRow
          v-if="group.id === 'fromOtherApps'"
          :icon="PlusIcon"
          :title="$t('settings.dataManagement.import.requestMore.title')"
          :href="EXTERNAL_URLS.featurebaseRoadmap"
          dashed
        />
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <span class="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        {{ $t('settings.dataManagement.import.groups.history') }}
      </span>
      <div class="divide-border divide-y overflow-hidden rounded-lg border">
        <DataSourceRow
          :icon="HistoryIcon"
          :title="$t('settings.dataManagement.importHistory.title')"
          :description="$t('settings.dataManagement.importHistory.listDescription')"
          :to="{ name: ROUTES_NAMES.importHistory }"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import DocsLink from '@/components/common/docs-link.vue';
import { ROUTES_NAMES } from '@/routes';
import { EXTERNAL_URLS } from '@bt/shared/const/external-urls';
import { DatabaseIcon, FileTextIcon, FileSpreadsheetIcon, HistoryIcon, PlusIcon, SparklesIcon } from '@lucide/vue';
import { type Component } from 'vue';
import { type RouteLocationRaw } from 'vue-router';

import DataSourceRow from '../components/data-source-row.vue';

defineOptions({
  name: 'settings-data-management-import',
});

// Brand logos served statically from `public/`.
const YNAB_LOGO = '/img/logos/ynab.webp';
const BUDGETBAKERS_LOGO = '/img/logos/budgetbakers.webp';

interface ImportSource {
  // Doubles as the Vue list key and the i18n namespace segment under `settings.dataManagement`.
  id: string;
  // Either a Lucide icon component (`icon`) or a brand logo image (`iconSrc`).
  icon?: Component;
  iconSrc?: string;
  to: RouteLocationRaw;
  accent?: boolean;
  badge?: boolean;
}

interface ImportGroup {
  id: 'filesAndText' | 'fromOtherApps';
  sources: ImportSource[];
}

const groups: ImportGroup[] = [
  {
    id: 'filesAndText',
    sources: [
      { id: 'textSource', icon: SparklesIcon, to: { name: ROUTES_NAMES.importStatement }, accent: true, badge: true },
      { id: 'csv', icon: FileSpreadsheetIcon, to: { name: ROUTES_NAMES.importCsv } },
      { id: 'ofx', icon: FileTextIcon, to: { name: ROUTES_NAMES.importOfx } },
    ],
  },
  {
    id: 'fromOtherApps',
    sources: [
      { id: 'ynab', iconSrc: YNAB_LOGO, to: { name: ROUTES_NAMES.importYnab } },
      { id: 'budget-bakers-wallet', iconSrc: BUDGETBAKERS_LOGO, to: { name: ROUTES_NAMES.importBudgetBakersWallet } },
      // Microsoft Money is discontinued and has no brand asset we ship, so it
      // uses a generic database icon — a `.mny` file is a database file.
      { id: 'ms-money', icon: DatabaseIcon, to: { name: ROUTES_NAMES.importMsMoney } },
    ],
  },
];
</script>
