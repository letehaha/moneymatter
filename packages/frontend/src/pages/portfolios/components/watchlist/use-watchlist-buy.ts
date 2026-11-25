import { getHoldingTransactions } from '@/api/investment-transactions';
import { useNotificationCenter } from '@/components/notification-center';
import { useCreateHolding, useDeleteHolding, useHoldings } from '@/composable/data-queries/holdings';
import { notifyMutationError } from '@/composable/data-queries/use-invalidating-mutation';
import { ApiErrorResponseError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import type { WatchlistItemModel } from '@bt/shared/types';
import type { HoldingModel } from '@bt/shared/types/investments';
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

/** Transactions need a holding, so buying an unheld security creates an empty one, removed again if the dialog closes without a transaction. */
export const useWatchlistBuy = ({ portfolioId }: { portfolioId: Ref<string> }) => {
  const { t } = useI18n();
  const { addErrorNotification } = useNotificationCenter();
  const { data: holdings, isSuccess: holdingsLoaded, refetch: refetchHoldings } = useHoldings(portfolioId);
  const createHolding = useCreateHolding();
  const deleteHolding = useDeleteHolding();

  const buyingItemId = ref<string | null>(null);
  const isCleaningUp = ref(false);
  const buyHolding = ref<HoldingModel | null>(null);
  const isBuyOpen = ref(false);
  const placeholder = ref<{ securityId: string; symbol: string } | null>(null);

  const canBuy = computed(() => holdingsLoaded.value && !buyingItemId.value && !isCleaningUp.value);

  const removePlaceholder = async () => {
    const current = placeholder.value;
    if (!current) return;
    placeholder.value = null;
    isCleaningUp.value = true;
    try {
      const { total } = await getHoldingTransactions({
        portfolioId: portfolioId.value,
        securityId: current.securityId,
        limit: 1,
      });
      if (total === 0)
        await deleteHolding.mutateAsync({ portfolioId: portfolioId.value, securityId: current.securityId });
    } catch (error) {
      captureException({
        error,
        context: {
          scope: 'watchlist-buy:remove-placeholder',
          portfolioId: portfolioId.value,
          securityId: current.securityId,
        },
      });
      addErrorNotification(t('portfolioDetail.watchlist.placeholderCleanupError', { symbol: current.symbol }));
    } finally {
      isCleaningUp.value = false;
    }
    await refetchHoldings();
  };

  const openBuy = async ({ item }: { item: WatchlistItemModel }) => {
    if (!canBuy.value) return;
    const securityId = item.security.id;
    const find = () => holdings.value?.find((holding) => holding.securityId === securityId);
    buyingItemId.value = item.id;
    try {
      if (!find()) {
        await createHolding.mutateAsync({ portfolioId: portfolioId.value, securityId, quantity: 0, costBasis: 0 });
        placeholder.value = { securityId, symbol: item.security.symbol ?? item.security.name ?? '' };
        await refetchHoldings();
      }
      const holding = find();
      if (!holding) throw new Error('Holding is missing after creating it');
      buyHolding.value = holding;
      isBuyOpen.value = true;
    } catch (error) {
      if (!(error instanceof ApiErrorResponseError)) {
        captureException({
          error,
          context: { scope: 'watchlist-buy:open', portfolioId: portfolioId.value, securityId },
        });
      }
      notifyMutationError({ error, fallbackKey: 'portfolioDetail.watchlist.buyError' });
      await removePlaceholder();
    } finally {
      buyingItemId.value = null;
    }
  };

  watch(isBuyOpen, (isOpen) => {
    if (!isOpen) removePlaceholder();
  });
  onScopeDispose(removePlaceholder);

  return { buyHolding, isBuyOpen, canBuy, openBuy };
};
