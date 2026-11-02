<template>
  <div class="space-y-4">
    <template v-if="step === 'key'">
      <InputField
        v-model="keyId"
        :label="$t('pages.integrations.yaxi.keyIdLabel')"
        :placeholder="$t('pages.integrations.yaxi.keyIdPlaceholder')"
      />
      <InputField
        v-model="secret"
        type="password"
        :label="$t('pages.integrations.yaxi.secretLabel')"
        :placeholder="$t('pages.integrations.yaxi.secretPlaceholder')"
        :error-message="secretError"
        @keyup.enter="handleConnect"
      />
      <p v-if="isIntegrationKey" class="text-warning-text text-sm">
        {{ $t('pages.integrations.yaxi.integrationKeyNote') }}
      </p>

      <CredentialsHelpTrigger :label="$t('pages.integrations.yaxi.help.trigger')" @click="showHelp = true" />

      <div class="flex justify-between gap-2">
        <UiButton variant="outline" :disabled="isLoading" @click="emit('cancel')">
          {{ $t('pages.integrations.yaxi.backButton') }}
        </UiButton>
        <DemoRestricted :message="$t('demo.featureNotAvailable')" feature="bank_connect_yaxi">
          <UiButton :disabled="!canConnect || isLoading || isDemo" :loading="isLoading" @click="handleConnect">
            {{ $t('pages.integrations.yaxi.connectButton') }}
          </UiButton>
        </DemoRestricted>
      </div>
    </template>

    <template v-else-if="step === 'bank'">
      <InputField
        v-model="searchTerm"
        autofocus
        :label="$t('pages.integrations.yaxi.searchLabel')"
        :placeholder="$t('pages.integrations.yaxi.searchPlaceholder')"
      />

      <p v-if="searchError" class="text-destructive-text text-sm">{{ searchError }}</p>
      <p v-else-if="isSearching" class="text-muted-foreground py-4 text-center text-sm">
        {{ $t('pages.integrations.yaxi.searching') }}
      </p>
      <p v-else-if="hasSearched && banks.length === 0" class="text-muted-foreground py-4 text-center text-sm">
        {{ $t('pages.integrations.yaxi.noBanksFound') }}
      </p>

      <ScrollArea v-if="banks.length" class="max-h-80">
        <div class="grid gap-0.5">
          <UiButton
            v-for="option in banks"
            :key="option.id"
            variant="ghost"
            class="h-auto w-full min-w-0 justify-start gap-3 px-3 py-2.5"
            @click="selectBank(option)"
          >
            <img
              v-if="logoUrl(option)"
              :src="logoUrl(option)"
              alt=""
              class="size-8 shrink-0 object-contain"
              @error="failedLogoIds.add(option.logoId!)"
            />
            <span v-else class="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full">
              <BuildingIcon class="text-muted-foreground size-4" />
            </span>
            <span class="min-w-0 flex-1 truncate text-left text-sm font-medium">{{ option.displayName }}</span>
            <span
              v-if="option.labels?.includes(BETA_LABEL)"
              class="bg-warning/20 text-warning-text shrink-0 rounded px-1.5 text-xs font-semibold"
            >
              {{ $t('pages.integrations.yaxi.betaLabel') }}
            </span>
          </UiButton>
        </div>
      </ScrollArea>

      <UiButton variant="outline" @click="emit('cancel')">
        {{ $t('pages.integrations.yaxi.backButton') }}
      </UiButton>
    </template>

    <template v-else-if="step === 'login' && bank">
      <div class="flex items-center gap-3">
        <img
          v-if="logoUrl(bank)"
          :src="logoUrl(bank)"
          alt=""
          class="size-8 shrink-0 object-contain"
          @error="failedLogoIds.add(bank.logoId!)"
        />
        <span class="font-medium">{{ bank.displayName }}</span>
      </div>

      <p v-if="loginError" class="text-destructive-text text-sm">{{ loginError }}</p>
      <p v-if="bank.advice && loginForm.userId !== 'hidden'" class="text-muted-foreground text-sm">
        {{ bank.advice }}
      </p>
      <p v-if="loginForm.userId !== 'required'" class="text-muted-foreground text-sm">
        {{ $t('pages.integrations.yaxi.redirectHint') }}
      </p>

      <InputField
        v-if="loginForm.userId !== 'hidden'"
        v-model="userId"
        :label="bank.userId || $t('pages.integrations.yaxi.userIdLabel')"
        :placeholder="
          loginForm.userId === 'optional'
            ? $t('pages.integrations.yaxi.userIdOptionalPlaceholder')
            : $t('pages.integrations.yaxi.userIdPlaceholder')
        "
      />
      <div v-if="loginForm.password">
        <InputField
          v-model="password"
          type="password"
          :label="bank.password || $t('pages.integrations.yaxi.passwordLabel')"
          :placeholder="$t('pages.integrations.yaxi.passwordPlaceholder')"
          @keyup.enter="handleLogin"
        />
        <p class="text-muted-foreground mt-1 text-xs">{{ $t('pages.integrations.yaxi.passwordNote') }}</p>
      </div>

      <div class="flex justify-between gap-2">
        <UiButton variant="outline" @click="backToBanks">
          {{ $t('pages.integrations.yaxi.backButton') }}
        </UiButton>
        <UiButton :disabled="!canLogin" @click="handleLogin">
          {{ $t('pages.integrations.yaxi.continueButton') }}
        </UiButton>
      </div>
    </template>

    <template v-else-if="step === 'dialog'">
      <p v-if="dialogStep.kind === 'redirect'" class="text-sm">{{ $t('pages.integrations.yaxi.redirectPrompt') }}</p>
      <template v-else>
        <p v-if="dialogStep.message" class="text-sm whitespace-pre-line">{{ dialogStep.message }}</p>
        <img v-if="dialogStep.imageUrl" :src="dialogStep.imageUrl" alt="" class="mx-auto max-w-full" />
      </template>

      <div v-if="dialogStep.kind === 'polling'" class="text-muted-foreground flex items-center gap-2 text-sm">
        <LoaderCircleIcon class="size-4 animate-spin" />
        {{
          dialogStep.redirectUrl
            ? $t('pages.integrations.yaxi.waitingForBank')
            : $t('pages.integrations.yaxi.waitingForYaxi')
        }}
      </div>

      <div v-else-if="dialogStep.kind === 'selection'" class="grid gap-1">
        <UiButton
          v-for="option in dialogStep.options"
          :key="option.key"
          variant="outline"
          class="h-auto w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
          @click="answer(option.key)"
        >
          <span>{{ option.label }}</span>
          <span v-if="option.explanation" class="text-muted-foreground text-xs font-normal">
            {{ option.explanation }}
          </span>
        </UiButton>
      </div>

      <InputField
        v-else-if="dialogStep.kind === 'field'"
        v-model="fieldValue"
        autofocus
        :type="dialogStep.masked ? 'password' : 'text'"
        :maxlength="dialogStep.maxLength"
        :label="$t('pages.integrations.yaxi.fieldLabel')"
        :placeholder="$t('pages.integrations.yaxi.fieldPlaceholder')"
        @keyup.enter="submitField"
      />

      <div class="flex justify-between gap-2">
        <UiButton v-if="!isCompleting" variant="outline" @click="cancelDialog">
          {{ $t('common.actions.cancel') }}
        </UiButton>

        <UiButton v-if="dialogStep.kind === 'confirmation'" @click="answer('')">
          {{ $t('pages.integrations.yaxi.confirmButton') }}
        </UiButton>
        <UiButton v-else-if="dialogStep.kind === 'field'" :disabled="!canSubmitField" @click="submitField">
          {{ $t('pages.integrations.yaxi.continueButton') }}
        </UiButton>
        <UiButton
          v-else-if="dialogStep.kind === 'redirect'"
          as="a"
          :href="dialogStep.url"
          target="_blank"
          rel="noopener"
          @click="answer('')"
        >
          {{ $t('pages.integrations.yaxi.openBankButton') }}
          <ExternalLinkIcon class="size-4" />
        </UiButton>
        <UiButton
          v-else-if="dialogStep.kind === 'polling' && dialogStep.redirectUrl"
          as="a"
          variant="ghost"
          :href="dialogStep.redirectUrl"
          target="_blank"
          rel="noopener"
        >
          {{ $t('pages.integrations.yaxi.openBankButton') }}
          <ExternalLinkIcon class="size-4" />
        </UiButton>
      </div>
    </template>

    <template v-else-if="step === 'accounts'">
      <div v-if="isLoading && !availableAccounts.length" class="py-8 text-center">
        {{ $t('pages.integrations.yaxi.loadingAccounts') }}
      </div>

      <template v-else>
        <p v-if="!availableAccounts.length" class="text-muted-foreground text-sm">
          {{ $t('pages.integrations.yaxi.noAccounts') }}
        </p>
        <div v-else class="text-muted-foreground text-sm">
          {{ $t('pages.integrations.yaxi.accountsPreviewHint', { count: availableAccounts.length }) }}
        </div>

        <div class="space-y-2">
          <div
            v-for="account in availableAccounts"
            :key="account.externalId"
            class="flex items-center gap-3 rounded-md border p-3"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">{{ account.name }}</div>
              <div class="text-muted-foreground truncate text-xs">{{ account.metadata?.iban || '' }}</div>
            </div>
            <div class="text-right">
              <div class="text-sm font-medium">
                {{ formatUIAmount(account.balance, { currency: account.currency }) }}
              </div>
              <div class="text-muted-foreground text-xs">{{ account.currency }}</div>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-4">
          <UiButton variant="ghost" size="sm" :disabled="isLoading" @click="emit('connected')">
            {{ $t('pages.integrations.yaxi.skipButton') }}
          </UiButton>
          <DemoRestricted :message="$t('demo.featureNotAvailable')" feature="bank_connect_yaxi_import_accounts">
            <UiButton
              :disabled="availableAccounts.length === 0 || isLoading || isDemo"
              :loading="isLoading"
              @click="handleImportAccounts"
            >
              {{ $t('pages.integrations.yaxi.importButton', { count: availableAccounts.length }) }}
            </UiButton>
          </DemoRestricted>
        </div>
      </template>
    </template>

    <InstructionsDialog v-model:open="showHelp" :title="$t('pages.integrations.yaxi.help.title')">
      <div class="space-y-2">
        <InstructionStep :step="1">
          <template #title>
            <i18n-t keypath="pages.integrations.yaxi.help.step1" tag="span">
              <template #link>
                <ExternalLink :href="YAXI_HUB_URL" />
              </template>
            </i18n-t>
          </template>
        </InstructionStep>
        <InstructionStep :step="2" :title="$t('pages.integrations.yaxi.help.step2')" />
        <InstructionStep :step="3" :title="$t('pages.integrations.yaxi.help.step3')" />
      </div>

      <template #footer>
        <UiButton as="a" :href="YAXI_HUB_URL" target="_blank" rel="noopener">
          <ExternalLinkIcon class="size-4" />
          {{ $t('pages.integrations.help.openSite', { site: 'hub.yaxi.tech' }) }}
        </UiButton>
      </template>
    </InstructionsDialog>
  </div>
</template>

<script lang="ts" setup>
import {
  type AvailableAccount,
  completeYaxiConnection,
  connectProvider,
  getAvailableAccounts,
  issueYaxiTicket,
  syncSelectedAccounts,
} from '@/api/bank-data-providers';
import { DemoRestricted } from '@/components/demo';
import ExternalLink from '@/components/external-link.vue';
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import { useSyncStatus } from '@/composable/use-sync-status';
import { ApiErrorResponseError, NetworkError } from '@/js/errors';
import { formatUIAmount } from '@/js/helpers';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore, useOnboardingStore, useUserStore } from '@/stores';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { BuildingIcon, ExternalLinkIcon, LoaderCircleIcon } from '@lucide/vue';
import { watchDebounced } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import type { ConnectionInfo, RoutexClient } from 'routex-client';
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import {
  type YaxiAskStep,
  type YaxiLoginForm,
  type YaxiPollingStep,
  YaxiCanceledError,
  buildYaxiCredentials,
  bytesToBase64,
  canSubmitYaxiLogin,
  driveYaxiLogin,
  getYaxiErrorMessage,
  isValidYaxiSecret,
  isYaxiIntegrationKey,
  resolveYaxiLoginForm,
} from '../utils/yaxi-flow';
import CredentialsHelpTrigger from './shared/credentials-help-trigger.vue';
import InstructionStep from './shared/instruction-step.vue';
import InstructionsDialog from './shared/instructions-dialog.vue';

const YAXI_HUB_URL = 'https://hub.yaxi.tech';
const LOGO_BASE_URL = 'https://logos.yaxi.tech/banks';
const BETA_LABEL = 'beta';
const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_LIMIT = 20;

const props = defineProps<{
  /** Runs the login against this existing connection instead of creating one from a key. */
  connectionId?: string;
  /** Starts the login at this bank instead of the search: linked accounts only sync at the bank they came from. */
  bankConnectionId?: string | null;
  skipImport?: boolean;
}>();

const emit = defineEmits<{
  'login-saved': [];
  connected: [];
  cancel: [];
}>();

const { t } = useI18n();
const router = useRouter();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
const { watchSync } = useSyncStatus();
const { isDemo } = storeToRefs(useUserStore());

const step = ref<'key' | 'bank' | 'login' | 'dialog' | 'accounts'>(props.connectionId ? 'bank' : 'key');
const isLoading = ref(false);
const showHelp = ref(false);
const activeConnectionId = ref(props.connectionId ?? '');

const keyId = ref('');
const secret = ref('');
const isIntegrationKey = computed(() => isYaxiIntegrationKey({ keyId: keyId.value }));
const secretError = computed(() =>
  secret.value.trim() && !isValidYaxiSecret({ secret: secret.value.trim() })
    ? t('pages.integrations.yaxi.errors.invalidSecret')
    : undefined,
);
const canConnect = computed(() => !!keyId.value.trim() && !!secret.value.trim() && !secretError.value);

const handleConnect = async () => {
  if (!canConnect.value || isLoading.value || isDemo.value) return;

  try {
    isLoading.value = true;
    const { connectionId } = await connectProvider(BANK_PROVIDER_TYPE.YAXI, {
      keyId: keyId.value.trim(),
      secret: secret.value.trim(),
    });
    activeConnectionId.value = connectionId;
    secret.value = '';
    step.value = 'bank';
  } catch (error) {
    addErrorNotification(
      getYaxiErrorMessage({ error, t, fallbackKey: 'pages.integrations.yaxi.errors.connectFailed' }),
    );
  } finally {
    isLoading.value = false;
  }
};

let client: RoutexClient | null = null;

const getRoutex = async () => {
  const { ticket, apiUrl } = await issueYaxiTicket({ connectionId: activeConnectionId.value });
  if (!client) {
    const { RoutexClient } = await import('routex-client');
    client = new RoutexClient({ url: new URL(apiUrl) });
  }
  return { ticket, routex: client };
};

const searchTerm = ref('');
const banks = ref<ConnectionInfo[]>([]);
const isSearching = ref(false);
const hasSearched = ref(false);
const searchError = ref('');
const failedLogoIds = reactive(new Set<string>());
let latestSearch = 0;

const logoUrl = ({ logoId }: ConnectionInfo) =>
  logoId && !failedLogoIds.has(logoId) ? `${LOGO_BASE_URL}/${logoId}.svg` : undefined;

const runSearch = async () => {
  if (step.value !== 'bank') return;

  const search = ++latestSearch;
  const term = searchTerm.value.trim();
  searchError.value = '';

  if (term.length < SEARCH_MIN_LENGTH) {
    banks.value = [];
    hasSearched.value = false;
    isSearching.value = false;
    return;
  }

  try {
    isSearching.value = true;
    const { ticket, routex } = await getRoutex();
    const found = await routex.search({ ticket, filters: [{ term }], ibanDetection: true, limit: SEARCH_LIMIT });
    if (search !== latestSearch) return;
    banks.value = found;
    hasSearched.value = true;
  } catch (error) {
    if (search !== latestSearch) return;
    banks.value = [];
    searchError.value = getYaxiErrorMessage({ error, t, fallbackKey: 'pages.integrations.yaxi.errors.searchFailed' });
  } finally {
    if (search === latestSearch) isSearching.value = false;
  }
};

watchDebounced(searchTerm, runSearch, { debounce: SEARCH_DEBOUNCE_MS });

const bank = ref<ConnectionInfo | null>(null);
const userId = ref('');
const password = ref('');
const loginError = ref('');

const loginForm = computed<YaxiLoginForm>(() =>
  bank.value ? resolveYaxiLoginForm({ credentials: bank.value.credentials }) : { userId: 'hidden', password: false },
);
const canLogin = computed(() =>
  canSubmitYaxiLogin({ form: loginForm.value, userId: userId.value, password: password.value }),
);

const selectBank = (option: ConnectionInfo) => {
  bank.value = option;
  latestSearch += 1;
  isSearching.value = false;
  loginError.value = '';
  step.value = 'login';
};

const backToBanks = () => {
  password.value = '';
  if (props.bankConnectionId) emit('cancel');
  else step.value = 'bank';
};

const startAtStoredBank = async ({ bankConnectionId }: { bankConnectionId: string }) => {
  const search = ++latestSearch;
  try {
    isSearching.value = true;
    const { ticket, routex } = await getRoutex();
    const storedBank = await routex.info(ticket, bankConnectionId);
    if (search === latestSearch) selectBank(storedBank);
  } catch (error) {
    if (search !== latestSearch) return;
    searchError.value = getYaxiErrorMessage({
      error,
      t,
      fallbackKey: 'pages.integrations.yaxi.errors.storedBankFailed',
    });
  } finally {
    if (search === latestSearch) isSearching.value = false;
  }
};

if (props.bankConnectionId) void startAtStoredBank({ bankConnectionId: props.bankConnectionId });

const dialogStep = ref<YaxiAskStep | YaxiPollingStep>({ kind: 'polling' });
const fieldValue = ref('');
let resolveAnswer: ((value: string) => void) | null = null;
let abortController: AbortController | null = null;
const isCompleting = ref(false);

const ask = (next: YaxiAskStep) =>
  new Promise<string>((resolve) => {
    fieldValue.value = '';
    dialogStep.value = next;
    resolveAnswer = resolve;
  });

const answer = (value: string) => {
  fieldValue.value = '';
  resolveAnswer?.(value);
  resolveAnswer = null;
};

const canSubmitField = computed(() => {
  if (dialogStep.value.kind !== 'field') return false;
  return fieldValue.value.length >= Math.max(dialogStep.value.minLength ?? 1, 1);
});

const submitField = () => {
  if (canSubmitField.value) answer(fieldValue.value);
};

const cancelDialog = () => abortController?.abort();

const handleLogin = async () => {
  if (!canLogin.value || !bank.value || step.value !== 'login') return;

  const selected = bank.value;
  const form = loginForm.value;
  const connectionId = activeConnectionId.value;
  const signal = (abortController = new AbortController()).signal;

  loginError.value = '';
  dialogStep.value = { kind: 'polling' };
  step.value = 'dialog';

  try {
    const { ticket, routex } = await getRoutex();
    const { AccountField } = await import('routex-client');

    if (signal.aborted) throw new YaxiCanceledError();

    const start = routex.accounts({
      credentials: buildYaxiCredentials({
        connectionId: selected.id,
        form,
        userId: userId.value,
        password: password.value,
      }),
      recurringConsents: true,
      ticket,
      fields: [
        AccountField.Iban,
        AccountField.Name,
        AccountField.DisplayName,
        AccountField.OwnerName,
        AccountField.Currency,
        AccountField.Type,
      ],
    });
    password.value = '';

    const result = await driveYaxiLogin({
      start,
      client: routex,
      ticket,
      redirectUri: new URL(router.resolve({ name: ROUTES_NAMES.bankLoginDone }).href, window.location.origin).href,
      ask,
      onPolling: (next) => {
        dialogStep.value = next;
      },
      signal,
    });

    isCompleting.value = true;
    if (!result.connectionData) throw new Error('YAXI returned no connection data');

    dialogStep.value = { kind: 'polling' };
    await completeYaxiConnection({
      connectionId,
      resultJwt: result.jwt,
      connectionData: bytesToBase64({ bytes: result.connectionData }),
      bankConnectionId: selected.id,
      bankName: selected.displayName,
      logoId: selected.logoId,
    });
    emit('login-saved');
    void watchSync();

    if (props.skipImport) {
      emit('connected');
      return;
    }
    await loadAccounts();
  } catch (error) {
    password.value = '';
    if (!(error instanceof YaxiCanceledError)) {
      loginError.value = getYaxiErrorMessage({
        error,
        t,
        fallbackKey: isCompleting.value
          ? 'pages.integrations.yaxi.errors.saveFailed'
          : 'pages.integrations.yaxi.errors.loginFailed',
      });
      if (isCompleting.value && !(error instanceof ApiErrorResponseError || error instanceof NetworkError)) {
        captureException({ error, context: { scope: 'yaxi-connector:complete-connection' } });
      }
    }
    step.value = 'login';
  } finally {
    isCompleting.value = false;
  }
};

const availableAccounts = ref<AvailableAccount[]>([]);

const loadAccounts = async () => {
  step.value = 'accounts';
  try {
    isLoading.value = true;
    availableAccounts.value = await getAvailableAccounts(activeConnectionId.value);
  } catch (error) {
    // The login is already saved, so accounts can still be connected later from the details page.
    addErrorNotification(
      getYaxiErrorMessage({ error, t, fallbackKey: 'pages.integrations.yaxi.errors.accountsFailed' }),
    );
    emit('connected');
  } finally {
    isLoading.value = false;
  }
};

const handleImportAccounts = async () => {
  if (availableAccounts.value.length === 0 || isLoading.value || isDemo.value) return;

  const allAccountIds = availableAccounts.value.map((account) => account.externalId);

  try {
    isLoading.value = true;
    await syncSelectedAccounts(activeConnectionId.value, allAccountIds);
  } catch (error) {
    addErrorNotification(getYaxiErrorMessage({ error, t, fallbackKey: 'pages.integrations.yaxi.errors.importFailed' }));
    return;
  } finally {
    isLoading.value = false;
  }

  void watchSync();
  void accountsStore.refetchAccounts();
  useOnboardingStore().completeTask('connect-bank');
  addSuccessNotification(t('pages.integrations.yaxi.importSuccess', { count: allAccountIds.length }));
  emit('connected');
};

onBeforeUnmount(() => {
  abortController?.abort();
  password.value = '';
  secret.value = '';
  fieldValue.value = '';
});
</script>
