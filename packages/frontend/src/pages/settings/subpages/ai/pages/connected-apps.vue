<template>
  <div class="flex flex-col gap-6">
    <!-- MCP Server Info -->
    <div>
      <h3 class="mb-2 text-lg font-medium">{{ $t('settings.aiIntegrations.mcpServer.title') }}</h3>
      <p class="text-muted-foreground mb-4 text-sm leading-relaxed">
        {{ $t('settings.aiIntegrations.mcpServer.description') }}
      </p>

      <div class="bg-muted flex items-center gap-2 rounded-lg p-3">
        <code class="flex-1 truncate text-sm">{{ mcpServerUrl }}</code>
        <DesktopOnlyTooltip :content="$t('settings.aiIntegrations.mcpServer.copyTooltip')">
          <UiButton variant="outline" size="icon-sm" @click="copyUrl">
            <CopyIcon v-if="!copied" class="size-4" />
            <CheckIcon v-else class="size-4" />
          </UiButton>
        </DesktopOnlyTooltip>
      </div>
    </div>

    <Separator />

    <!-- Quick Connect Buttons -->
    <div>
      <h3 class="mb-2 text-lg font-medium">{{ $t('settings.aiIntegrations.quickConnect.title') }}</h3>
      <p class="text-muted-foreground mb-4 text-sm leading-relaxed">
        {{ $t('settings.aiIntegrations.quickConnect.description') }}
      </p>

      <div class="flex flex-col gap-4">
        <!-- Claude -->
        <Collapsible v-model:open="isClaudeOpen">
          <div class="border-border rounded-lg border">
            <div class="flex items-center justify-between p-4">
              <div class="flex items-center gap-2">
                <ClaudeLogo class="size-7" />
                <span class="font-medium">Claude</span>
              </div>
              <div class="flex items-center gap-2">
                <UiButton variant="outline" size="sm" @click="openClaudeSettings">
                  {{ $t('settings.aiIntegrations.quickConnect.openSettings') }}
                  <ExternalLinkIcon class="size-3" />
                </UiButton>
                <CollapsibleTrigger as-child>
                  <UiButton variant="ghost" size="icon-sm">
                    <ChevronDownIcon class="size-4 transition-transform" :class="{ 'rotate-180': isClaudeOpen }" />
                  </UiButton>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent>
              <div class="border-border border-t px-4 pt-3 pb-4">
                <ol class="text-muted-foreground list-inside list-decimal space-y-2 text-sm">
                  <i18n-t keypath="settings.aiIntegrations.quickConnect.claude.steps.createConnector" tag="li">
                    <template #icon>
                      <strong class="text-foreground">+</strong>
                    </template>
                  </i18n-t>
                  <i18n-t keypath="settings.aiIntegrations.quickConnect.claude.steps.selectCustom" tag="li">
                    <template #action>
                      <strong class="text-foreground">
                        {{ $t('settings.aiIntegrations.actions.addCustomConnector') }}
                      </strong>
                    </template>
                  </i18n-t>
                  <i18n-t keypath="settings.aiIntegrations.quickConnect.claude.steps.enterName" tag="li">
                    <template #value>
                      <ClickToCopy value="MoneyMatter" />
                    </template>
                  </i18n-t>
                  <i18n-t keypath="settings.aiIntegrations.quickConnect.claude.steps.pasteUrl" tag="li">
                    <template #value>
                      <ClickToCopy :value="mcpServerUrl" />
                    </template>
                  </i18n-t>
                  <i18n-t keypath="settings.aiIntegrations.quickConnect.claude.steps.finish" tag="li">
                    <template #action>
                      <strong class="text-foreground">{{ $t('settings.aiIntegrations.actions.add') }}</strong>
                    </template>
                  </i18n-t>
                  <li>{{ $t('settings.aiIntegrations.quickConnect.claude.steps.authorize') }}</li>
                </ol>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        <!-- ChatGPT -->
        <Collapsible v-model:open="isChatGptOpen">
          <div class="border-border rounded-lg border">
            <div class="flex items-center justify-between p-4">
              <div class="flex items-center gap-2">
                <OpenAiLogo class="size-8" />
                <span class="font-medium">ChatGPT</span>
              </div>
              <div class="flex items-center gap-2">
                <UiButton variant="outline" size="sm" @click="openChatGptSettings">
                  {{ $t('settings.aiIntegrations.quickConnect.openSettings') }}
                  <ExternalLinkIcon class="size-3" />
                </UiButton>
                <CollapsibleTrigger as-child>
                  <UiButton variant="ghost" size="icon-sm">
                    <ChevronDownIcon class="size-4 transition-transform" :class="{ 'rotate-180': isChatGptOpen }" />
                  </UiButton>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent>
              <div class="border-border border-t px-4 pt-3 pb-4">
                <ol class="text-muted-foreground list-inside list-decimal space-y-2 text-sm">
                  <i18n-t keypath="settings.aiIntegrations.quickConnect.chatgpt.steps.addConnector" tag="li">
                    <template #action>
                      <strong class="text-foreground">
                        {{ $t('settings.aiIntegrations.actions.addConnector') }}
                      </strong>
                    </template>
                  </i18n-t>
                  <i18n-t keypath="settings.aiIntegrations.quickConnect.chatgpt.steps.pasteUrl" tag="li">
                    <template #value>
                      <ClickToCopy :value="mcpServerUrl" />
                    </template>
                  </i18n-t>
                  <i18n-t keypath="settings.aiIntegrations.quickConnect.chatgpt.steps.clickAdd" tag="li">
                    <template #action>
                      <strong class="text-foreground">{{ $t('settings.aiIntegrations.actions.add') }}</strong>
                    </template>
                  </i18n-t>
                  <li>{{ $t('settings.aiIntegrations.quickConnect.chatgpt.steps.authorize') }}</li>
                </ol>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>
    </div>

    <Separator />

    <!-- Active connectors -->
    <div>
      <h3 class="mb-2 text-lg font-medium">{{ $t('settings.aiIntegrations.connectedApps.title') }}</h3>
      <p class="text-muted-foreground mb-4 text-sm leading-relaxed">
        {{ $t('settings.aiIntegrations.connectedApps.description') }}
      </p>

      <div v-if="isLoading" class="flex flex-col gap-3">
        <div v-for="i in 2" :key="i" class="border-border flex items-center justify-between rounded-lg border p-4">
          <div class="flex-1 space-y-2">
            <div class="bg-muted/50 h-5 w-36 animate-pulse rounded" />
            <div class="bg-muted/30 h-3 w-48 animate-pulse rounded" />
            <div class="bg-muted/30 h-3 w-28 animate-pulse rounded" />
          </div>
          <div class="bg-muted/40 h-8 w-16 animate-pulse rounded" />
        </div>
      </div>

      <div v-else-if="!connectedApps?.length" class="text-muted-foreground py-8 text-center text-sm">
        <PlugIcon class="text-muted-foreground mx-auto mb-2 size-8" />
        <p>{{ $t('settings.aiIntegrations.connectedApps.emptyTitle') }}</p>
        <p class="mt-1">{{ $t('settings.aiIntegrations.connectedApps.emptyDescription') }}</p>
      </div>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="app in connectedApps"
          :key="app.clientId"
          class="border-border flex items-center justify-between rounded-lg border p-4"
        >
          <div class="min-w-0 flex-1">
            <div class="font-medium">{{ app.name || app.clientId }}</div>
            <div class="text-muted-foreground mt-1 text-xs">
              {{ $t('settings.aiIntegrations.connectedApps.connectedAt', { date: formatDate(app.connectedAt) }) }}
              <span v-if="app.lastUsedAt">
                &middot;
                {{ $t('settings.aiIntegrations.connectedApps.lastUsed', { time: formatRelative(app.lastUsedAt) }) }}
              </span>
            </div>
            <div class="text-muted-foreground mt-1 text-xs">
              {{ $t('settings.aiIntegrations.connectedApps.scope', { scopes: formatScopes(app.scopes) }) }}
            </div>
          </div>

          <UiButton variant="soft-destructive" size="sm" :disabled="isRevoking" @click="handleRevoke(app.clientId)">
            {{ $t('settings.aiIntegrations.connectedApps.revoke') }}
          </UiButton>
        </div>
      </div>
    </div>
  </div>

  <ResponsiveAlertDialog
    v-model:open="isRevokeDialogOpen"
    :confirm-label="$t('settings.aiIntegrations.revokeDialog.confirm')"
    confirm-variant="destructive"
    @confirm="confirmRevoke"
  >
    <template #title>{{ $t('settings.aiIntegrations.revokeDialog.title') }}</template>
    <template #description>
      {{ $t('settings.aiIntegrations.revokeDialog.description') }}
    </template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import { getConnectedApps, getMcpServerUrl, revokeConnectedApp } from '@/api/mcp';
import ClickToCopy from '@/components/common/click-to-copy.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { Separator } from '@/components/lib/ui/separator';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { HIDDEN_OAUTH_SCOPES } from '@/common/const/oauth-scopes';
import { useClipboard } from '@vueuse/core';
import { format, formatDistanceToNow } from 'date-fns';
import ClaudeLogo from '@/assets/icons/logos/claude.svg';
import OpenAiLogo from '@/assets/icons/logos/openai.svg';
import { CheckIcon, ChevronDownIcon, CopyIcon, ExternalLinkIcon, PlugIcon } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const queryClient = useQueryClient();

const isClaudeOpen = ref(false);
const isChatGptOpen = ref(false);
const isRevokeDialogOpen = ref(false);
const revokeTargetClientId = ref<string | null>(null);

const mcpServerUrl = getMcpServerUrl();

const { copy, copied } = useClipboard({ source: mcpServerUrl });

const { data: connectedApps, isLoading } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.mcpConnectedApps,
  queryFn: getConnectedApps,
  placeholderData: [],
});

const { mutate: revokeMutation, isPending: isRevoking } = useMutation({
  mutationFn: ({ clientId }: { clientId: string }) => revokeConnectedApp({ clientId }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.mcpConnectedApps });
    addSuccessNotification(t('settings.aiIntegrations.revokeDialog.successNotification'));
  },
  onError: () => {
    addErrorNotification(t('settings.aiIntegrations.revokeDialog.errorNotification'));
  },
  onSettled: () => {
    isRevokeDialogOpen.value = false;
    revokeTargetClientId.value = null;
  },
});

function copyUrl() {
  copy(mcpServerUrl);
  addSuccessNotification(t('settings.aiIntegrations.mcpServer.copiedNotification'));
}

function openClaudeSettings() {
  window.open('https://claude.ai/customize/connectors', '_blank');
}

function openChatGptSettings() {
  window.open('https://chatgpt.com/settings#settings/Connectors', '_blank');
}

function formatDate(dateStr: string) {
  return format(new Date(dateStr), 'MMM d, yyyy');
}

function formatRelative(dateStr: string) {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
}

function formatScopes(scopes: string[]) {
  const labels: Record<string, string> = {
    'finance:read': t('settings.aiIntegrations.scopes.financeRead'),
    'finance:write': t('settings.aiIntegrations.scopes.financeWrite'),
    'finance:delete': t('settings.aiIntegrations.scopes.financeDelete'),
    'profile:read': t('settings.aiIntegrations.scopes.profileRead'),
    offline_access: t('settings.aiIntegrations.scopes.offlineAccess'),
  };
  return scopes
    .filter((s) => !HIDDEN_OAUTH_SCOPES.has(s))
    .map((s) => labels[s] || s)
    .join(', ');
}

function handleRevoke(clientId: string) {
  revokeTargetClientId.value = clientId;
  isRevokeDialogOpen.value = true;
}

function confirmRevoke() {
  if (!revokeTargetClientId.value) return;
  revokeMutation({ clientId: revokeTargetClientId.value });
}
</script>
