import {
  getOnboardingState as fetchOnboardingStateApi,
  updateOnboardingState as updateOnboardingStateApi,
} from '@/api/onboarding';
import { i18n } from '@/i18n';
import { ROUTES_NAMES } from '@/routes/constants';
import { defineStore, storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import { useUserStore } from './user';

export interface OnboardingTask {
  id: string;
  title: string;
  description?: string;
  route?: string;
}

export interface OnboardingCategory {
  id: string;
  title: string;
  icon: string;
  tasks: OnboardingTask[];
}

// Raw category/task structure (without translations)
interface RawTask {
  id: string;
  route?: string;
  /** If true, this task is hidden for demo users */
  demoHidden?: boolean;
}

interface RawCategory {
  id: string;
  icon: string;
  tasks: RawTask[];
}

// Define all onboarding categories and tasks (IDs and routes only)
const RAW_CATEGORIES: RawCategory[] = [
  {
    id: 'getting-started',
    icon: 'rocket',
    tasks: [
      { id: 'create-account', route: ROUTES_NAMES.accounts },
      { id: 'add-transaction', route: ROUTES_NAMES.transactions },
    ],
  },
  {
    id: 'advanced-transactions',
    icon: 'layers',
    tasks: [
      { id: 'create-transfer', route: ROUTES_NAMES.transactions },
      { id: 'link-refund', route: ROUTES_NAMES.transactions },
      { id: 'link-transactions', route: ROUTES_NAMES.transactions },
      { id: 'split-transaction', route: ROUTES_NAMES.transactions },
      { id: 'mark-transfer-out', route: ROUTES_NAMES.transactions },
    ],
  },
  {
    id: 'organization',
    icon: 'folder',
    tasks: [
      { id: 'create-category', route: ROUTES_NAMES.settingsCategories },
      { id: 'create-tag', route: ROUTES_NAMES.settingsTags },
      { id: 'create-budget', route: ROUTES_NAMES.plannedBudgets },
      { id: 'create-account-group', route: ROUTES_NAMES.settingsAccounts },
      { id: 'setup-tag-reminder', route: ROUTES_NAMES.settingsTags },
      { id: 'create-subscription', route: ROUTES_NAMES.plannedSubscriptions },
    ],
  },
  {
    id: 'bank-import',
    icon: 'link',
    tasks: [
      { id: 'connect-bank', route: ROUTES_NAMES.accounts, demoHidden: true },
      { id: 'import-csv', route: ROUTES_NAMES.settingsDataManagement },
    ],
  },
  {
    id: 'analytics',
    icon: 'chart',
    tasks: [
      { id: 'view-annual-overview', route: ROUTES_NAMES.analytics },
      { id: 'view-cash-flow', route: ROUTES_NAMES.analyticsCashFlow },
    ],
  },
  {
    id: 'ai-settings',
    icon: 'sparkles',
    tasks: [
      { id: 'review-ai-features', route: ROUTES_NAMES.settingsAiFeatures },
      { id: 'configure-ai', route: ROUTES_NAMES.settingsAiModels },
    ],
  },
  {
    id: 'sharing',
    icon: 'users',
    tasks: [
      { id: 'invite-household-member', route: ROUTES_NAMES.settingsHousehold },
      { id: 'share-account', route: ROUTES_NAMES.accounts },
    ],
  },
];

// Helper to get translated category (with optional demo filtering)
const translateCategory = ({ raw, isDemo }: { raw: RawCategory; isDemo: boolean }): OnboardingCategory => {
  const t = i18n.global.t;
  const prefix = 'dashboard.onboarding.quickStart';

  // Filter out demo-hidden tasks when in demo mode
  const filteredTasks = isDemo ? raw.tasks.filter((task) => !task.demoHidden) : raw.tasks;

  return {
    id: raw.id,
    icon: raw.icon,
    title: t(`${prefix}.categories.${raw.id}.title`),
    tasks: filteredTasks.map((task) => ({
      id: task.id,
      route: task.route,
      title: t(`${prefix}.tasks.${task.id}.title`),
      description: t(`${prefix}.tasks.${task.id}.description`),
    })),
  };
};

export const useOnboardingStore = defineStore('onboarding', () => {
  // External stores
  const userStore = useUserStore();
  const { isDemo } = storeToRefs(userStore);

  // State
  const completedTasks = ref<string[]>([]);
  const isDismissed = ref(false);
  const dismissedAt = ref<string | null>(null);
  const isPanelOpen = ref(false);
  const expandedCategories = ref<string[]>([]);
  const isLoading = ref(false);
  const isInitialized = ref(false);

  // Helper to get filtered categories (excludes demo-hidden tasks in demo mode)
  const getFilteredCategories = () =>
    RAW_CATEGORIES.map((raw) => translateCategory({ raw, isDemo: isDemo.value })).filter(
      (category) => category.tasks.length > 0,
    );

  // Helper to get filtered raw tasks (for counting)
  const getFilteredRawTasks = () => {
    const tasks = RAW_CATEGORIES.flatMap((c) => c.tasks);
    return isDemo.value ? tasks.filter((t) => !t.demoHidden) : tasks;
  };

  // Getters
  const categories = computed(() => getFilteredCategories());

  const allTasks = computed(() => getFilteredRawTasks());

  const totalTasks = computed(() => allTasks.value.length);

  // Only count tasks that exist in the current task list (filters out old/removed task IDs)
  const validTaskIds = computed(() => new Set(allTasks.value.map((t) => t.id)));
  const completedCount = computed(() => completedTasks.value.filter((id) => validTaskIds.value.has(id)).length);

  const progressPercentage = computed(() => Math.round((completedCount.value / totalTasks.value) * 100));

  const isAllComplete = computed(() => completedCount.value === totalTasks.value);

  const remainingCount = computed(() => totalTasks.value - completedCount.value);

  const shouldShowTrigger = computed(() => !isDismissed.value && isInitialized.value);

  const isTaskCompleted = (taskId: string): boolean => completedTasks.value.includes(taskId);

  const getCategoryProgress = (categoryId: string): { completed: number; total: number } => {
    const category = RAW_CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return { completed: 0, total: 0 };
    const completed = category.tasks.filter((t) => isTaskCompleted(t.id)).length;
    return { completed, total: category.tasks.length };
  };

  const isCategoryExpanded = (categoryId: string): boolean => expandedCategories.value.includes(categoryId);

  const isCategoryComplete = (categoryId: string): boolean => {
    const progress = getCategoryProgress(categoryId);
    return progress.completed === progress.total;
  };

  // Actions
  const fetchOnboardingState = async () => {
    isLoading.value = true;
    try {
      const data = await fetchOnboardingStateApi();
      completedTasks.value = data.completedTasks;
      isDismissed.value = data.isDismissed;
      dismissedAt.value = data.dismissedAt;
      isInitialized.value = true;

      // Auto-open panel on first visit if not dismissed and not all complete.
      // Demo users land on a data-rich dashboard — starting collapsed avoids
      // shrinking the page content on first impression.
      if (!data.isDismissed && completedTasks.value.length < allTasks.value.length && !isDemo.value) {
        isPanelOpen.value = true;

        // Expand the first category that has incomplete tasks
        const firstIncompleteCategory = RAW_CATEGORIES.find((category) => {
          const hasIncompleteTasks = category.tasks.some((task) => !completedTasks.value.includes(task.id));
          return hasIncompleteTasks;
        });
        if (firstIncompleteCategory) {
          expandedCategories.value = [firstIncompleteCategory.id];
        }
      }
    } catch (error) {
      console.error('Failed to fetch onboarding state:', error);
    } finally {
      isLoading.value = false;
    }
  };

  const completeTask = async (taskId: string) => {
    // Skip if already completed or if onboarding is dismissed
    if (completedTasks.value.includes(taskId) || isDismissed.value) return;

    // Optimistically update UI
    completedTasks.value = [...completedTasks.value, taskId];

    try {
      await updateOnboardingStateApi({
        state: { completedTasks: completedTasks.value },
      });
    } catch (error) {
      // Revert on failure
      completedTasks.value = completedTasks.value.filter((id) => id !== taskId);
      console.error('Failed to complete task:', error);
    }
  };

  const dismissPermanently = async () => {
    const now = new Date().toISOString();
    isDismissed.value = true;
    dismissedAt.value = now;
    isPanelOpen.value = false;

    try {
      await updateOnboardingStateApi({
        state: { isDismissed: true, dismissedAt: now },
      });
    } catch (error) {
      // Revert on failure
      isDismissed.value = false;
      dismissedAt.value = null;
      console.error('Failed to dismiss onboarding:', error);
    }
  };

  const reopen = async () => {
    isDismissed.value = false;
    dismissedAt.value = null;

    try {
      await updateOnboardingStateApi({
        state: { isDismissed: false, dismissedAt: null },
      });
    } catch (error) {
      console.error('Failed to reopen onboarding:', error);
    }
  };

  const toggleCategory = (categoryId: string) => {
    const index = expandedCategories.value.indexOf(categoryId);
    if (index === -1) {
      expandedCategories.value.push(categoryId);
    } else {
      expandedCategories.value.splice(index, 1);
    }
  };

  const openPanel = () => {
    isPanelOpen.value = true;
  };

  const closePanel = () => {
    isPanelOpen.value = false;
  };

  const reset = () => {
    completedTasks.value = [];
    isDismissed.value = false;
    dismissedAt.value = null;
    isPanelOpen.value = false;
    expandedCategories.value = [];
    isInitialized.value = false;
  };

  return {
    // State
    completedTasks,
    isDismissed,
    dismissedAt,
    isPanelOpen,
    expandedCategories,
    isLoading,
    isInitialized,

    // Getters
    categories,
    allTasks,
    totalTasks,
    completedCount,
    progressPercentage,
    isAllComplete,
    remainingCount,
    shouldShowTrigger,
    isTaskCompleted,
    getCategoryProgress,
    isCategoryExpanded,
    isCategoryComplete,

    // Actions
    fetchOnboardingState,
    completeTask,
    dismissPermanently,
    reopen,
    toggleCategory,
    openPanel,
    closePanel,
    reset,
  };
});
