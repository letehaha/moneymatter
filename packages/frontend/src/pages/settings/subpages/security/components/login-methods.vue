<template>
  <div class="space-y-6">
    <div>
      <h3 class="mb-1 text-lg font-medium">{{ $t('settings.security.loginMethods.title') }}</h3>
      <p class="text-muted-foreground text-sm">{{ $t('settings.security.loginMethods.description') }}</p>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <Loader2Icon class="text-muted-foreground size-6 animate-spin" />
    </div>

    <template v-else>
      <!-- OAuth Providers -->
      <div v-for="provider in OAUTH_PROVIDERS_LIST" :key="provider" class="border-border rounded-lg border p-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="bg-muted flex size-10 items-center justify-center rounded-lg">
              <component :is="providerConfig[provider].icon" />
            </div>
            <div>
              <p class="font-medium">{{ providerConfig[provider].name }}</p>
              <p v-if="getAccountByProvider(provider)" class="text-muted-foreground text-sm">
                {{
                  $t('settings.security.loginMethods.oauth.connectedAs', {
                    email:
                      getAccountByProvider(provider)?.email ||
                      $t('settings.security.loginMethods.oauth.accountName', {
                        provider: providerConfig[provider].name,
                      }),
                  })
                }}
              </p>
              <p v-else class="text-muted-foreground text-sm">
                {{ $t('settings.security.loginMethods.oauth.notConnected') }}
              </p>
            </div>
          </div>
          <Button
            v-if="getAccountByProvider(provider)"
            variant="outline"
            size="sm"
            :disabled="!canDisconnect || isDisconnecting"
            @click="handleDisconnectOAuth({ provider })"
          >
            <Loader2Icon v-if="isDisconnecting" class="mr-2 size-4 animate-spin" />
            {{ $t('settings.security.loginMethods.oauth.disconnect') }}
          </Button>
          <DemoRestricted v-else feature="connect_oauth_provider">
            <Button
              variant="outline"
              size="sm"
              :disabled="isConnecting || isDemo"
              @click="handleConnectOAuth({ provider })"
            >
              <Loader2Icon v-if="isConnecting" class="mr-2 size-4 animate-spin" />
              {{ $t('settings.security.loginMethods.oauth.connect') }}
            </Button>
          </DemoRestricted>
        </div>
      </div>

      <!-- Password -->
      <div class="border-border rounded-lg border p-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="bg-muted flex size-10 items-center justify-center rounded-lg">
              <LockIcon class="text-muted-foreground size-5" />
            </div>
            <div>
              <p class="font-medium">{{ $t('settings.security.loginMethods.password.title') }}</p>
              <p v-if="hasPassword" class="text-muted-foreground text-sm">
                {{ $t('settings.security.loginMethods.password.passwordSet') }}
              </p>
              <p v-else class="text-muted-foreground text-sm">
                {{ $t('settings.security.loginMethods.password.noPassword') }}
              </p>
            </div>
          </div>
          <span class="text-muted-foreground text-sm">
            {{
              hasPassword
                ? $t('settings.security.loginMethods.password.manageInTab')
                : $t('settings.security.loginMethods.password.setupInTab')
            }}
          </span>
        </div>
      </div>

      <!-- Passkeys -->
      <div class="border-border rounded-lg border p-4">
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="bg-muted flex size-10 items-center justify-center rounded-lg">
              <KeyRoundIcon class="text-muted-foreground size-5" />
            </div>
            <div>
              <p class="font-medium">{{ $t('settings.security.loginMethods.passkeys.title') }}</p>
              <p class="text-muted-foreground text-sm">
                {{
                  passkeys.length === 0
                    ? $t('settings.security.loginMethods.passkeys.noPasskeys')
                    : $t('settings.security.loginMethods.passkeys.passkeyCount', { count: passkeys.length })
                }}
              </p>
            </div>
          </div>
          <DemoRestricted feature="add_passkey">
            <Button variant="outline" size="sm" :disabled="isAddingPasskey || isDemo" @click="handleAddPasskey">
              <Loader2Icon v-if="isAddingPasskey" class="mr-2 size-4 animate-spin" />
              <PlusIcon v-else class="mr-2 size-4" />
              {{ $t('settings.security.loginMethods.passkeys.addButton') }}
            </Button>
          </DemoRestricted>
        </div>

        <!-- List of passkeys -->
        <div v-if="passkeys.length > 0" class="border-t pt-4">
          <div v-for="passkey in passkeys" :key="passkey.id" class="flex items-center justify-between gap-2 py-2">
            <form
              v-if="editingPasskeyId === passkey.id"
              class="flex flex-1 items-center gap-2"
              @submit.prevent="handleRenamePasskey(passkey.id)"
            >
              <InputField
                v-model="editingName"
                class="flex-1"
                autofocus
                :placeholder="$t('settings.security.loginMethods.passkeys.renamePlaceholder')"
                @keydown.esc="editingPasskeyId = null"
              />
              <DesktopOnlyTooltip :content="$t('common.actions.save')">
                <Button type="submit" size="icon-sm" :disabled="!editingName.trim() || isRenamingPasskey">
                  <Loader2Icon v-if="isRenamingPasskey" class="size-4 animate-spin" />
                  <CheckIcon v-else class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
              <DesktopOnlyTooltip :content="$t('common.actions.cancel')">
                <Button type="button" variant="ghost" size="icon-sm" @click="editingPasskeyId = null">
                  <XIcon class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
            </form>
            <template v-else>
              <div class="flex items-center gap-3">
                <FingerprintIcon class="text-muted-foreground size-5" />
                <div>
                  <p class="text-sm font-medium">
                    {{ passkey.name || $t('settings.security.loginMethods.passkeys.passkeyName') }}
                  </p>
                  <p class="text-muted-foreground text-xs">
                    {{ $t('settings.security.loginMethods.passkeys.added', { date: formatDate(passkey.createdAt) }) }}
                  </p>
                </div>
              </div>
              <div class="flex items-center">
                <DesktopOnlyTooltip :content="$t('settings.security.loginMethods.passkeys.rename')">
                  <Button variant="ghost" size="icon-sm" @click="startRenamePasskey(passkey)">
                    <PencilIcon class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
                <DesktopOnlyTooltip :content="$t('common.actions.delete')">
                  <Button
                    variant="ghost-destructive"
                    size="icon-sm"
                    :disabled="!canDisconnect || isDeletingPasskey === passkey.id"
                    @click="passkeyToDelete = passkey"
                  >
                    <Loader2Icon v-if="isDeletingPasskey === passkey.id" class="size-4 animate-spin" />
                    <TrashIcon v-else class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
              </div>
            </template>
          </div>
        </div>
      </div>

      <ResponsiveAlertDialog
        :open="!!passkeyToDelete"
        :confirm-label="$t('common.actions.delete')"
        confirm-variant="destructive"
        :confirm-disabled="!!isDeletingPasskey"
        @update:open="(open) => !open && (passkeyToDelete = null)"
        @confirm="handleDeletePasskey"
      >
        <template #title>{{ $t('settings.security.loginMethods.passkeys.deleteConfirmTitle') }}</template>
        <template #description>
          {{
            $t('settings.security.loginMethods.passkeys.deleteConfirmDescription', {
              name: passkeyToDelete?.name || $t('settings.security.loginMethods.passkeys.passkeyName'),
            })
          }}
        </template>
      </ResponsiveAlertDialog>

      <!-- Warning if only one login method -->
      <p v-if="!canDisconnect && hasAnyOAuthAccount" class="text-muted-foreground text-sm">
        <AlertTriangleIcon class="mr-1 inline size-4" />
        {{ $t('settings.security.loginMethods.warningOneMethod') }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { GithubIcon, GoogleIcon } from '@/components/auth';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { authClient } from '@/lib/auth-client';
import { useAuthStore, useUserStore } from '@/stores';
import { OAUTH_PROVIDER, OAUTH_PROVIDERS_LIST } from '@bt/shared/types';
import {
  AlertTriangleIcon,
  CheckIcon,
  FingerprintIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { type Component, computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

const providerConfig: Record<OAUTH_PROVIDER, { name: string; icon: Component }> = {
  [OAUTH_PROVIDER.google]: { name: 'Google', icon: GoogleIcon },
  [OAUTH_PROVIDER.github]: { name: 'GitHub', icon: GithubIcon },
};

interface Passkey {
  id: string;
  name?: string | null;
  createdAt: Date;
}

interface Account {
  id: string;
  providerId: string;
  accountId: string;
  email?: string;
}

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const userStore = useUserStore();
const { isDemo } = storeToRefs(userStore);
const { t } = useI18n();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();

const isLoading = ref(true);
const isConnecting = ref(false);
const isDisconnecting = ref(false);
const isAddingPasskey = ref(false);
const isDeletingPasskey = ref<string | null>(null);
const passkeyToDelete = ref<Passkey | null>(null);
const editingPasskeyId = ref<string | null>(null);
const editingName = ref('');
const isRenamingPasskey = ref(false);

const accounts = ref<Account[]>([]);
const passkeys = ref<Passkey[]>([]);
const hasPassword = ref(false);

const getAccountByProvider = (provider: OAUTH_PROVIDER) => accounts.value.find((a) => a.providerId === provider);

const hasAnyOAuthAccount = computed(() => OAUTH_PROVIDERS_LIST.some((p) => getAccountByProvider(p)));

// Count total login methods
const loginMethodCount = computed(() => {
  const oauthCount = OAUTH_PROVIDERS_LIST.filter((p) => getAccountByProvider(p)).length;
  const passkeyCount = passkeys.value.length;
  const passwordCount = hasPassword.value ? 1 : 0;
  return oauthCount + passkeyCount + passwordCount;
});

const canDisconnect = computed(() => loginMethodCount.value > 1);

const formatDate = (dateStr: string | Date) => {
  return new Date(dateStr).toLocaleDateString();
};

const loadAccounts = async () => {
  try {
    const result = await authClient.listAccounts();
    if (result.data) {
      accounts.value = result.data;
      // Check if user has a password (credential account)
      hasPassword.value = result.data.some((a: Account) => a.providerId === 'credential');
    }
  } catch (e) {
    console.error('Failed to load accounts:', e);
  }
};

const loadPasskeys = async () => {
  try {
    const result = await authClient.passkey.listUserPasskeys();
    if (result.data) {
      passkeys.value = result.data;
    }
  } catch (e) {
    console.error('Failed to load passkeys:', e);
  }
};

const handleConnectOAuth = async ({ provider }: { provider: OAUTH_PROVIDER }) => {
  const providerName = providerConfig[provider].name;
  try {
    isConnecting.value = true;
    sessionStorage.setItem('oauth_return_url', window.location.pathname);
    await authClient.linkSocial({
      provider,
      callbackURL: `${window.location.origin}/auth/callback`,
    });
  } catch {
    addErrorNotification(
      t('settings.security.loginMethods.notifications.oauthConnectFailed', { provider: providerName }),
    );
  } finally {
    isConnecting.value = false;
  }
};

const handleDisconnectOAuth = async ({ provider }: { provider: OAUTH_PROVIDER }) => {
  const account = getAccountByProvider(provider);
  const providerName = providerConfig[provider].name;

  if (!account || !canDisconnect.value) return;

  try {
    isDisconnecting.value = true;
    await authClient.unlinkAccount({
      providerId: provider,
      accountId: account.accountId,
    });
    addSuccessNotification(
      t('settings.security.loginMethods.notifications.oauthDisconnectSuccess', { provider: providerName }),
    );
    await loadAccounts();
  } catch {
    addErrorNotification(
      t('settings.security.loginMethods.notifications.oauthDisconnectFailed', { provider: providerName }),
    );
  } finally {
    isDisconnecting.value = false;
  }
};

const handleAddPasskey = async () => {
  try {
    isAddingPasskey.value = true;
    await authStore.registerPasskey();
    addSuccessNotification(t('settings.security.loginMethods.notifications.passkeyAddSuccess'));
    await loadPasskeys();
  } catch {
    addErrorNotification(t('settings.security.loginMethods.notifications.passkeyAddFailed'));
  } finally {
    isAddingPasskey.value = false;
  }
};

const startRenamePasskey = (passkey: Passkey) => {
  editingPasskeyId.value = passkey.id;
  editingName.value = passkey.name ?? '';
};

const handleRenamePasskey = async (passkeyId: string) => {
  const name = editingName.value.trim();
  if (!name) return;

  try {
    isRenamingPasskey.value = true;
    await authClient.passkey.updatePasskey({ id: passkeyId, name });
    editingPasskeyId.value = null;
    await loadPasskeys();
  } catch {
    addErrorNotification(t('settings.security.loginMethods.notifications.passkeyRenameFailed'));
  } finally {
    isRenamingPasskey.value = false;
  }
};

const handleDeletePasskey = async () => {
  const passkeyId = passkeyToDelete.value?.id;
  if (!passkeyId || !canDisconnect.value) return;

  try {
    isDeletingPasskey.value = passkeyId;
    await authClient.passkey.deletePasskey({ id: passkeyId });
    addSuccessNotification(t('settings.security.loginMethods.notifications.passkeyRemoveSuccess'));
    passkeyToDelete.value = null;
    await loadPasskeys();
  } catch {
    addErrorNotification(t('settings.security.loginMethods.notifications.passkeyRemoveFailed'));
  } finally {
    isDeletingPasskey.value = null;
  }
};

onMounted(async () => {
  // Check for OAuth error from callback redirect
  const oauthError = route.query.oauth_error as string | undefined;
  if (oauthError) {
    addErrorNotification(oauthError);
    // Clean up the URL without triggering a navigation
    router.replace({ query: {} });
  }

  isLoading.value = true;
  await Promise.all([loadAccounts(), loadPasskeys()]);
  isLoading.value = false;
});
</script>
