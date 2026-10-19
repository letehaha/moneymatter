import {
  detectOfxDuplicates as apiDetectOfxDuplicates,
  executeOfxImport,
  getOfxImportStatus,
  uploadOfxFile,
} from '@/api/import-ofx';
import { refreshResourceLease } from '@/api/resource-leases';
import { getErrorMessage } from '@/common/utils/error-message';
import { useImportJobProgress } from '@/composable/use-import-job-progress';
import { useRecalculateBalanceToggle } from '@/composable/use-recalculate-balance-toggle';
import { useWizardSteps } from '@/composable/use-wizard-steps';
import { i18n } from '@/i18n';
import { captureException } from '@/lib/sentry';
import { matchValuesByName } from '@/pages/import-export/utils/auto-match';
import { useAccountsStore } from '@/stores/accounts';
import { useCurrenciesStore } from '@/stores/currencies';
import {
  ResourceLeaseType,
  SSE_EVENT_TYPES,
  type DuplicateMatch,
  type OfxAccountMapping,
  type OfxImportProgress,
  type OfxParseAccount,
  type OfxParseResult,
  type ResourceLease,
} from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

type OfxImportStepKey = 'upload' | 'resolve' | 'review' | 'results';

const OFX_STEP_KEYS: readonly OfxImportStepKey[] = ['upload', 'resolve', 'review', 'results'];

export const OFX_STEP_LABEL_KEYS: Record<OfxImportStepKey, string> = {
  upload: 'pages.importExport.ofxImport.stepper.steps.upload',
  resolve: 'pages.importExport.ofxImport.stepper.steps.resolve',
  review: 'pages.importExport.ofxImport.stepper.steps.review',
  results: 'pages.importExport.ofxImport.stepper.steps.results',
};

export function toOfxImportStepKey({ key }: { key: string }): OfxImportStepKey | null {
  return OFX_STEP_KEYS.find((stepKey) => stepKey === key) ?? null;
}

type OfxAccountFormValue =
  | { action: 'create-new'; name: string; currencyCode: string; currentBalance: number | null }
  | { action: 'link-existing'; accountId: string | undefined }
  | { action: 'skip' };

type OfxAccountFormMapping = Record<string, OfxAccountFormValue>;

export const useImportOfxStore = defineStore('import-ofx', () => {
  const queryClient = useQueryClient();
  const {
    currentStepKey,
    completedStepKeys,
    visibleSteps,
    goToStep,
    goBack,
    markStepCompleted,
    reset: resetSteps,
  } = useWizardSteps<OfxImportStepKey>({ stepKeys: OFX_STEP_KEYS });

  const uploadId = ref<string | null>(null);
  const lease = ref<ResourceLease | null>(null);
  const parsedResult = ref<OfxParseResult | null>(null);
  const accountMapping = ref<OfxAccountFormMapping>({});
  const duplicates = ref<DuplicateMatch[]>([]);
  const unmarkedDuplicateIndices = ref<Set<number>>(new Set());
  // FITID matches are enforced by a unique index on the server, so re-including
  // one can never import it. The UI locks those rows; this keeps the count honest.
  const skipDuplicateIndices = computed(() =>
    duplicates.value
      .filter((item) => item.matchType === 'originalId' || !unmarkedDuplicateIndices.value.has(item.rowIndex))
      .map((item) => item.rowIndex),
  );

  const jobProgress = useImportJobProgress<OfxImportProgress>({
    sseEventType: SSE_EVENT_TYPES.OFX_IMPORT_PROGRESS,
    fetchStatus: getOfxImportStatus,
    onComplete: async () => {
      queryClient.invalidateQueries();
      await Promise.allSettled([
        useAccountsStore()
          .refetchAccounts()
          .catch((error) => captureException({ error, context: { scope: 'import-ofx:post-import-accounts' } })),
        useCurrenciesStore()
          .loadCurrencies({ force: true })
          .catch((error) => captureException({ error, context: { scope: 'import-ofx:post-import-currencies' } })),
      ]);
    },
    onFailure: () => {},
    onLostContact: () => goToStep('review'),
  });
  const progress = jobProgress.progress;
  const executeError = jobProgress.executeError;
  const isEnqueuing = ref(false);
  const isExecuting = computed(
    () => isEnqueuing.value || progress.value?.status === 'queued' || progress.value?.status === 'running',
  );
  const hasActiveJob = computed(() => isExecuting.value || progress.value !== null);

  const {
    recalculateBalance,
    settingsLoading: recalculateBalanceSettingLoading,
    settingsLoadFailed: recalculateBalanceSettingLoadFailed,
    persistRecalculateBalanceSetting,
    resetOverride: resetRecalculateBalanceOverride,
  } = useRecalculateBalanceToggle({ sentryScope: 'import-ofx:persist-recalculate-balance' });

  const uploadError = ref<string | null>(null);
  const isUploading = ref(false);
  const isDetectingDuplicates = ref(false);
  const detectError = ref<string | null>(null);

  const accountByKey = computed(
    () => new Map((parsedResult.value?.accounts ?? []).map((account) => [account.sourceAccountKey, account])),
  );
  const skippedAccountKeys = computed(() =>
    Object.entries(accountMapping.value)
      .filter(([, value]) => value.action === 'skip')
      .map(([key]) => key),
  );
  const hasAnyLinkExisting = computed(() =>
    Object.values(accountMapping.value).some((value) => value.action === 'link-existing'),
  );
  const isAccountResolved = (value: OfxAccountFormValue | undefined) =>
    (value?.action === 'create-new' && value.name.trim().length > 0) ||
    value?.action === 'skip' ||
    (value?.action === 'link-existing' && !!value.accountId);
  const accountResolvedCount = computed(
    () =>
      (parsedResult.value?.accounts ?? []).filter((account) =>
        isAccountResolved(accountMapping.value[account.sourceAccountKey]),
      ).length,
  );
  const isResolveStepValid = computed(
    () =>
      (parsedResult.value?.accounts.length ?? 0) > 0 &&
      accountResolvedCount.value === parsedResult.value?.accounts.length,
  );

  function createNewValue({ account }: { account: OfxParseAccount }): OfxAccountFormValue {
    return {
      action: 'create-new',
      name: account.suggestedLocalName,
      currencyCode: account.currency,
      currentBalance: null,
    };
  }

  function autoMatchResolveValues({ overwrite }: { overwrite: boolean }): void {
    const accounts = parsedResult.value?.accounts ?? [];
    const targets = useAccountsStore().importLinkableAccounts.map((account) => ({
      id: String(account.id),
      name: account.name,
      currencyCode: account.currencyCode,
    }));
    const sources = accounts.map((account) => ({ name: account.suggestedLocalName, currencyCode: account.currency }));
    const matches = matchValuesByName({ sources, targets });
    const usedTargets = new Set<string>();

    for (const account of accounts) {
      const key = account.sourceAccountKey;
      if (!overwrite && accountMapping.value[key]) continue;
      const matchedId = matches.get(account.suggestedLocalName);
      if (matchedId != null && !usedTargets.has(String(matchedId))) {
        accountMapping.value[key] = { action: 'link-existing', accountId: String(matchedId) };
        usedTargets.add(String(matchedId));
      } else {
        accountMapping.value[key] = createNewValue({ account });
      }
    }
  }

  async function prepareResolveStep(): Promise<void> {
    const accountsStore = useAccountsStore();
    if (!accountsStore.isAccountsFetched) {
      await accountsStore.refetchAccounts().catch((error) => {
        captureException({ error, context: { scope: 'import-ofx:load-accounts' } });
      });
    }
    autoMatchResolveValues({ overwrite: false });
  }

  function setAccountAction({ name: key, action }: { name: string; action: 'create-new' | 'link-existing' | 'skip' }) {
    const account = accountByKey.value.get(key);
    if (!account) return;
    if (action === 'create-new') accountMapping.value[key] = createNewValue({ account });
    else if (action === 'link-existing') accountMapping.value[key] = { action: 'link-existing', accountId: undefined };
    else accountMapping.value[key] = { action: 'skip' };
  }

  function setAccountTarget({ name: key, accountId }: { name: string; accountId: string }) {
    accountMapping.value[key] = { action: 'link-existing', accountId: accountId || undefined };
  }

  function setAccountName({ sourceAccountKey, name }: { sourceAccountKey: string; name: string }) {
    const value = accountMapping.value[sourceAccountKey];
    if (value?.action === 'create-new') value.name = name;
  }

  function setAccountCurrentBalance({ name: key, currentBalance }: { name: string; currentBalance: number | null }) {
    const value = accountMapping.value[key];
    if (value?.action === 'create-new') value.currentBalance = currentBalance;
  }

  function quickMapExactMatches() {
    const accounts = parsedResult.value?.accounts ?? [];
    const targets = useAccountsStore().importLinkableAccounts.map((account) => ({
      id: String(account.id),
      name: account.name,
      currencyCode: account.currencyCode,
    }));
    const matches = matchValuesByName({
      sources: accounts.map((account) => ({ name: account.suggestedLocalName, currencyCode: account.currency })),
      targets,
    });
    const usedTargets = new Set<string>();
    for (const account of accounts) {
      const matchedId = matches.get(account.suggestedLocalName);
      if (matchedId == null || usedTargets.has(String(matchedId))) continue;
      accountMapping.value[account.sourceAccountKey] = {
        action: 'link-existing',
        accountId: String(matchedId),
      };
      usedTargets.add(String(matchedId));
    }
  }

  function quickCreateNewForUnmatched() {
    for (const account of parsedResult.value?.accounts ?? []) {
      if (!isAccountResolved(accountMapping.value[account.sourceAccountKey])) {
        accountMapping.value[account.sourceAccountKey] = createNewValue({ account });
      }
    }
  }

  function resetResolveAccounts() {
    accountMapping.value = {};
    autoMatchResolveValues({ overwrite: false });
  }

  function toggleDuplicateUnmark({ rowIndex }: { rowIndex: number }) {
    const next = new Set(unmarkedDuplicateIndices.value);
    if (next.has(rowIndex)) next.delete(rowIndex);
    else next.add(rowIndex);
    unmarkedDuplicateIndices.value = next;
  }

  function toWireAccountMapping(): OfxAccountMapping {
    const wire: OfxAccountMapping = {};
    for (const [key, value] of Object.entries(accountMapping.value)) {
      if (value.action === 'link-existing') {
        if (!value.accountId) throw new Error(`Account "${key}" has no selected target.`);
        wire[key] = { action: 'link-existing', accountId: value.accountId };
      } else if (value.action === 'create-new') {
        const name = value.name.trim();
        if (!name) throw new Error(`Account "${key}" has no name.`);
        wire[key] = { ...value, name };
      } else wire[key] = value;
    }
    return wire;
  }

  async function uploadFile({ file }: { file: File }): Promise<void> {
    isUploading.value = true;
    uploadError.value = null;
    detectError.value = null;
    jobProgress.setExecuteError(null);
    try {
      const response = await uploadOfxFile({ file });
      uploadId.value = response.uploadId;
      lease.value = response.lease;
      parsedResult.value = response.result;
      accountMapping.value = {};
      duplicates.value = [];
      unmarkedDuplicateIndices.value = new Set();
      markStepCompleted('upload');
      goToStep('resolve');
      await prepareResolveStep();
    } catch (error) {
      uploadError.value = getErrorMessage(error, i18n.global.t('errors.api.unexpectedError'));
      throw error;
    } finally {
      isUploading.value = false;
    }
  }

  async function refreshLease(): Promise<ResourceLease | null> {
    if (!uploadId.value) return null;
    const next = await refreshResourceLease({ type: ResourceLeaseType.ofxUpload, id: uploadId.value });
    lease.value = next;
    return next;
  }

  async function detectDuplicates(): Promise<void> {
    if (!uploadId.value) {
      detectError.value = i18n.global.t('pages.importExport.ofxImport.errors.uploadUnavailable');
      goToStep('upload');
      return;
    }
    if (!hasAnyLinkExisting.value) {
      duplicates.value = [];
      unmarkedDuplicateIndices.value = new Set();
      markStepCompleted('resolve');
      goToStep('review');
      return;
    }
    isDetectingDuplicates.value = true;
    detectError.value = null;
    try {
      const response = await apiDetectOfxDuplicates({
        uploadId: uploadId.value,
        accountMapping: toWireAccountMapping(),
      });
      duplicates.value = response.duplicates;
      unmarkedDuplicateIndices.value = new Set();
      markStepCompleted('resolve');
      goToStep('review');
    } catch (error) {
      detectError.value = getErrorMessage(error, i18n.global.t('errors.api.unexpectedError'));
      throw error;
    } finally {
      isDetectingDuplicates.value = false;
    }
  }

  async function execute(): Promise<void> {
    if (isExecuting.value) return;
    if (!uploadId.value) {
      jobProgress.setExecuteError(i18n.global.t('pages.importExport.ofxImport.errors.uploadUnavailable'));
      goToStep('upload');
      return;
    }
    jobProgress.setExecuteError(null);
    isEnqueuing.value = true;
    let response: Awaited<ReturnType<typeof executeOfxImport>>;
    try {
      response = await executeOfxImport({
        uploadId: uploadId.value,
        accountMapping: toWireAccountMapping(),
        skipDuplicateIndices: skipDuplicateIndices.value,
        recalculateBalance: recalculateBalance.value,
      });
    } catch (error) {
      jobProgress.setExecuteError(getErrorMessage(error, i18n.global.t('errors.api.unexpectedError')));
      return;
    } finally {
      isEnqueuing.value = false;
    }
    persistRecalculateBalanceSetting();
    markStepCompleted('review');
    goToStep('results');
    jobProgress.start({
      initialProgress: { jobId: response.jobId, status: 'queued', processedCount: 0, totalCount: 0 },
    });
  }

  function reset() {
    uploadId.value = null;
    lease.value = null;
    parsedResult.value = null;
    accountMapping.value = {};
    duplicates.value = [];
    unmarkedDuplicateIndices.value = new Set();
    resetRecalculateBalanceOverride();
    progress.value = null;
    resetSteps();
    uploadError.value = null;
    isUploading.value = false;
    isDetectingDuplicates.value = false;
    detectError.value = null;
    isEnqueuing.value = false;
    jobProgress.setExecuteError(null);
    jobProgress.stop();
  }

  return {
    uploadId,
    lease,
    parsedResult,
    accountMapping,
    duplicates,
    unmarkedDuplicateIndices,
    progress,
    currentStepKey,
    completedStepKeys,
    visibleSteps,
    uploadError,
    isUploading,
    isDetectingDuplicates,
    detectError,
    executeError,
    isExecuting,
    hasActiveJob,
    accountResolvedCount,
    isResolveStepValid,
    hasAnyLinkExisting,
    skippedAccountKeys,
    skipDuplicateIndices,
    recalculateBalance,
    recalculateBalanceSettingLoading,
    recalculateBalanceSettingLoadFailed,
    goToStep,
    goBack,
    markStepCompleted,
    prepareResolveStep,
    setAccountAction,
    setAccountTarget,
    setAccountName,
    setAccountCurrentBalance,
    autoMatchResolveValues,
    quickMapExactMatches,
    quickCreateNewForUnmatched,
    resetResolveAccounts,
    toggleDuplicateUnmark,
    uploadFile,
    refreshLease,
    detectDuplicates,
    execute,
    reset,
  };
});
