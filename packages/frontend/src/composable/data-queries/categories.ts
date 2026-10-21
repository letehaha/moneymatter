import { loadCategoriesByAccount } from '@/api/categories';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { QUERY_CACHE_STALE_TIME } from '@/common/const/vue-query';
import type { FormattedCategory } from '@/common/types';
import { useNotificationCenter } from '@/components/notification-center';
import { buildCategoriesObjectGraph } from '@/stores/categories/helpers';
import type { CategoryModel } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, toValue, watch } from 'vue';
import { useI18n } from 'vue-i18n';

export const useAccountCategories = ({
  accountId,
  enabled,
}: {
  accountId: MaybeRefOrGetter<string | undefined>;
  enabled?: MaybeRefOrGetter<boolean>;
}) => {
  const query = useQuery({
    queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.categoriesByAccount, toValue(accountId)] as const),
    queryFn: () => loadCategoriesByAccount({ accountId: toValue(accountId)! }),
    enabled: computed(() => {
      const flag = enabled === undefined ? true : toValue(enabled);
      return flag && toValue(accountId) !== undefined;
    }),
    staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  });

  // Surface fetch failures to the user. Without this the picker silently shows an empty
  // category list, indistinguishable from "owner has no categories", and the manage-tx
  // dialog can hang on its `isSuccess` gate forever.
  const { addErrorNotification } = useNotificationCenter();
  const { t } = useI18n();
  watch(query.isError, (isError) => {
    if (isError) {
      addErrorNotification(t('fields.categorySelect.sharedOwnerCategoriesLoadError'));
    }
  });

  const list = computed<CategoryModel[]>(() => query.data.value ?? []);

  const formatted = computed<FormattedCategory[]>(() => buildCategoriesObjectGraph({ items: list.value }));

  const map = computed<Record<string, CategoryModel>>(() =>
    list.value.reduce(
      (acc, curr) => {
        acc[curr.id] = curr;
        return acc;
      },
      {} as Record<string, CategoryModel>,
    ),
  );

  return {
    ...query,
    list,
    formatted,
    map,
  };
};
