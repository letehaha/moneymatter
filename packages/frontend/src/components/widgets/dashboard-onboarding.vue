<template>
  <div class="mx-auto w-full max-w-2xl">
    <!-- Header -->
    <div class="mb-8 text-center">
      <h1 class="text-3xl font-semibold tracking-tight">{{ $t('dashboard.onboarding.title') }}</h1>
      <p class="text-muted-foreground mt-2 text-base">{{ $t('dashboard.onboarding.subtitle') }}</p>
    </div>

    <!-- Primary Options -->
    <div class="grid gap-3 sm:grid-cols-2">
      <CreateAccountDialog>
        <button
          class="border-border hover:border-foreground/25 hover:bg-hover group flex w-full items-start gap-4 rounded-lg border bg-transparent p-5 text-left transition-all"
        >
          <div class="bg-primary/10 group-hover:bg-primary/15 rounded-lg p-2.5 transition-colors">
            <WalletIcon class="text-primary-text size-5" />
          </div>
          <div>
            <h3 class="font-medium">{{ $t('dashboard.onboarding.createManualAccount.title') }}</h3>
            <p class="text-muted-foreground mt-1 text-sm leading-relaxed">
              {{ $t('dashboard.onboarding.createManualAccount.description') }}
            </p>
          </div>
        </button>
      </CreateAccountDialog>

      <button
        class="border-border hover:border-foreground/25 hover:bg-hover group flex w-full items-start gap-4 rounded-lg border bg-transparent p-5 text-left transition-all"
        @click="navigateToIntegrations"
      >
        <div class="bg-primary/10 group-hover:bg-primary/15 rounded-lg p-2.5 transition-colors">
          <LandmarkIcon class="text-primary-text size-5" />
        </div>
        <div>
          <h3 class="font-medium">{{ $t('dashboard.onboarding.connectBank.title') }}</h3>
          <p class="text-muted-foreground mt-1 text-sm leading-relaxed">
            {{ $t('dashboard.onboarding.connectBank.description') }}
          </p>
        </div>
      </button>
    </div>

    <!-- Divider -->
    <div class="relative my-8">
      <div class="border-border absolute inset-0 flex items-center">
        <div class="border-border w-full border-t"></div>
      </div>
      <div class="relative flex justify-center">
        <span class="bg-background text-muted-foreground px-3 text-sm">{{ $t('dashboard.onboarding.divider') }}</span>
      </div>
    </div>

    <!-- Secondary Option - Import -->
    <button
      class="border-border hover:border-foreground/25 hover:bg-hover group flex w-full items-center gap-4 rounded-lg border bg-transparent p-5 text-left transition-all"
      @click="navigateToImport"
    >
      <div class="bg-muted group-hover:bg-muted/80 rounded-lg p-2.5 transition-colors">
        <FileUpIcon class="text-muted-foreground size-5" />
      </div>
      <div class="flex-1">
        <h3 class="font-medium">{{ $t('dashboard.onboarding.importFile.title') }}</h3>
        <p class="text-muted-foreground mt-0.5 text-sm">{{ $t('dashboard.onboarding.importFile.description') }}</p>
      </div>
      <ArrowRightIcon class="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
    </button>
  </div>
</template>

<script setup lang="ts">
import CreateAccountDialog from '@/components/dialogs/create-account-dialog.vue';
import { ROUTES_NAMES } from '@/routes';
import { ArrowRightIcon, FileUpIcon, LandmarkIcon, WalletIcon } from '@lucide/vue';
import { useRouter } from 'vue-router';

const router = useRouter();

const navigateToIntegrations = () => {
  router.push({ name: ROUTES_NAMES.accounts, query: { connect: 'bank' } });
};

const navigateToImport = () => {
  router.push({ name: ROUTES_NAMES.settingsDataManagement });
};
</script>
