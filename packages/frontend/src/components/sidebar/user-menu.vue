<script setup lang="ts">
import { config } from '@/common/config';
import RedditIcon from '@/components/common/icons/reddit-icon.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Popover from '@/components/lib/ui/popover';
import { useLogout } from '@/composable/actions/logout';
import { useAvailableUpdate } from '@/composable/use-available-update';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { EXTERNAL_URLS } from '@bt/shared/const/external-urls';
import { BookOpenIcon, ChevronUpIcon, CircleArrowUpIcon, ExternalLinkIcon, LogOutIcon, UserIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

defineProps<{ compact?: boolean; elevated?: boolean }>();

const { t } = useI18n();
const { user } = storeToRefs(useUserStore());
const logoutHandler = useLogout();
const isOpen = ref(false);
const availableUpdate = useAvailableUpdate();
const appRelease = __APP_RELEASE__;
const commitHash = __APP_VERSION__;
// Builds without git (no CI hash, no .git) fall back to a `dev-<timestamp>` id that isn't a commit.
const isRealCommit = /^[0-9a-f]{40}$/.test(commitHash);
</script>

<template>
  <div :class="cn('flex items-center gap-1', elevated && 'bg-card border-border rounded-md border pr-1.5')">
    <Popover.Popover v-model:open="isOpen">
      <Popover.PopoverTrigger as-child>
        <button
          :class="
            cn(
              'hover:bg-accent flex items-center rounded-md transition-colors',
              compact ? 'size-10 justify-center' : 'min-w-0 flex-1 gap-2 px-3 py-2 text-left',
            )
          "
          :aria-label="compact ? (user?.email ?? undefined) : undefined"
        >
          <div
            class="bg-primary/20 text-primary-text relative flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          >
            {{ user?.email?.charAt(0).toUpperCase() || '?' }}
            <span
              v-if="availableUpdate"
              class="bg-primary ring-card absolute -top-px -right-px size-2.5 rounded-full ring-2"
            >
              <span class="sr-only">{{ t('navigation.updateAvailable') }}</span>
            </span>
          </div>
          <template v-if="!compact">
            <span class="text-muted-foreground min-w-0 flex-1 truncate text-sm">
              {{ user?.email || 'User' }}
            </span>
            <ChevronUpIcon
              :class="['text-muted-foreground size-4 shrink-0 transition-transform', isOpen && 'rotate-180']"
            />
          </template>
        </button>
      </Popover.PopoverTrigger>
      <Popover.PopoverContent :side="compact ? 'right' : 'top'" :align="compact ? 'end' : 'start'" class="w-56 p-1">
        <router-link :to="{ name: ROUTES_NAMES.settingsSecurity }" @click="isOpen = false">
          <UiButton variant="ghost" class="w-full justify-start gap-2 px-3" size="default">
            <UserIcon class="size-4" />
            <span>{{ t('navigation.accountDetails') }}</span>
          </UiButton>
        </router-link>

        <a :href="config.docsUrl" target="_blank" rel="noopener noreferrer" @click="isOpen = false">
          <UiButton variant="ghost" class="w-full justify-start gap-2 px-3" size="default">
            <BookOpenIcon class="size-4" />
            <span>{{ t('navigation.helpAndDocs') }}</span>
            <ExternalLinkIcon class="text-muted-foreground ml-auto size-3" />
          </UiButton>
        </a>

        <a :href="EXTERNAL_URLS.redditCommunity" target="_blank" rel="noopener noreferrer" @click="isOpen = false">
          <UiButton variant="ghost" class="w-full justify-start gap-2 px-3" size="default">
            <RedditIcon class="size-4" />
            <span>{{ t('navigation.community') }}</span>
            <ExternalLinkIcon class="text-muted-foreground ml-auto size-3" />
          </UiButton>
        </a>

        <a
          v-if="availableUpdate"
          :href="availableUpdate.url"
          target="_blank"
          rel="noopener noreferrer"
          @click="isOpen = false"
        >
          <UiButton variant="ghost-primary" class="w-full justify-start gap-2 px-3" size="default">
            <CircleArrowUpIcon class="size-4" />
            <span>{{ t('navigation.updateAvailable') }}</span>
            <span class="ml-auto font-mono text-xs">{{ availableUpdate.version }}</span>
          </UiButton>
        </a>

        <UiButton
          variant="ghost-destructive"
          class="w-full justify-start gap-2 px-3"
          size="default"
          @click="
            logoutHandler();
            isOpen = false;
          "
        >
          <LogOutIcon class="size-4" />
          <span>{{ $t('navigation.logout') }}</span>
        </UiButton>
      </Popover.PopoverContent>
    </Popover.Popover>

    <slot name="trailing" />
  </div>

  <div v-if="config.isSelfHost && !compact" class="flex items-center justify-between gap-2 px-3 text-xs">
    <i18n-t keypath="navigation.appVersion" tag="span" class="text-muted-foreground truncate">
      <template #version>
        <span class="text-foreground font-medium">{{ appRelease }}</span>
      </template>
    </i18n-t>
    <a
      v-if="availableUpdate"
      :href="availableUpdate.url"
      target="_blank"
      rel="noopener noreferrer"
      class="bg-primary/15 text-primary-text hover:bg-primary/25 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-semibold transition-colors"
    >
      <CircleArrowUpIcon class="size-3" />
      {{ t('navigation.updateToVersion', { version: availableUpdate.version }) }}
    </a>
    <a
      v-else-if="isRealCommit"
      :href="`https://github.com/letehaha/moneymatter/commit/${commitHash}`"
      target="_blank"
      rel="noopener noreferrer"
      class="bg-muted hover:bg-accent text-foreground flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono transition-colors"
    >
      {{ commitHash.slice(0, 7) }}
      <ExternalLinkIcon class="size-3" />
    </a>
  </div>
</template>
