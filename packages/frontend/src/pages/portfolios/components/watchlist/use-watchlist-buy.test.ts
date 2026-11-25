import type { WatchlistItemModel } from '@bt/shared/types';
import type { HoldingModel } from '@bt/shared/types/investments';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';

const mocks = vi.hoisted(() => ({
  getHoldingTransactions: vi.fn(),
  createHolding: vi.fn(),
  deleteHolding: vi.fn(),
  addErrorNotification: vi.fn(),
  notifyMutationError: vi.fn(),
  captureException: vi.fn(),
  serverHoldings: [] as { securityId: string }[],
}));

const holdings = ref<{ securityId: string }[]>([]);

vi.mock('@/api/investment-transactions', () => ({ getHoldingTransactions: mocks.getHoldingTransactions }));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification: mocks.addErrorNotification }),
}));
vi.mock('@/composable/data-queries/holdings', () => ({
  useHoldings: () => ({
    data: holdings,
    isSuccess: ref(true),
    refetch: async () => {
      holdings.value = [...mocks.serverHoldings];
    },
  }),
  useCreateHolding: () => ({ mutateAsync: mocks.createHolding }),
  useDeleteHolding: () => ({ mutateAsync: mocks.deleteHolding }),
}));
vi.mock('@/composable/data-queries/use-invalidating-mutation', () => ({
  notifyMutationError: mocks.notifyMutationError,
}));
vi.mock('@/js/errors', () => ({ ApiErrorResponseError: class extends Error {} }));
vi.mock('@/lib/sentry', () => ({ captureException: mocks.captureException }));
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => `${key} ${JSON.stringify(params)}` }),
}));

import { useWatchlistBuy } from './use-watchlist-buy';

const PORTFOLIO_ID = 'portfolio-1';
const SECURITY_ID = 'security-1';
const item = { id: 'item-1', security: { id: SECURITY_ID, symbol: 'AAPL' } } as unknown as WatchlistItemModel;

const setup = () => effectScope().run(() => useWatchlistBuy({ portfolioId: ref(PORTFOLIO_ID) }))!;

const closeDialog = async ({ buy }: { buy: ReturnType<typeof setup> }) => {
  buy.isBuyOpen.value = false;
  await flushPromises();
};

describe('useWatchlistBuy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    holdings.value = [];
    mocks.serverHoldings = [];
    mocks.createHolding.mockImplementation(async () => {
      mocks.serverHoldings = [{ securityId: SECURITY_ID }];
    });
  });

  it('opens the dialog on an existing holding without creating or deleting anything', async () => {
    holdings.value = [{ securityId: SECURITY_ID }];
    const buy = setup();

    await buy.openBuy({ item });
    expect(buy.isBuyOpen.value).toBe(true);
    expect((buy.buyHolding.value as HoldingModel).securityId).toBe(SECURITY_ID);

    await closeDialog({ buy });
    expect(mocks.createHolding).not.toHaveBeenCalled();
    expect(mocks.getHoldingTransactions).not.toHaveBeenCalled();
    expect(mocks.deleteHolding).not.toHaveBeenCalled();
  });

  it('creates a placeholder for an unheld security and deletes it when closed with no transactions', async () => {
    mocks.getHoldingTransactions.mockResolvedValue({ total: 0 });
    const buy = setup();

    await buy.openBuy({ item });
    expect(mocks.createHolding).toHaveBeenCalledWith({
      portfolioId: PORTFOLIO_ID,
      securityId: SECURITY_ID,
      quantity: 0,
      costBasis: 0,
    });
    expect(buy.isBuyOpen.value).toBe(true);

    await closeDialog({ buy });
    expect(mocks.deleteHolding).toHaveBeenCalledWith({ portfolioId: PORTFOLIO_ID, securityId: SECURITY_ID });
  });

  it('keeps the placeholder when transactions were added', async () => {
    mocks.getHoldingTransactions.mockResolvedValue({ total: 1 });
    const buy = setup();

    await buy.openBuy({ item });
    await closeDialog({ buy });

    expect(mocks.getHoldingTransactions).toHaveBeenCalled();
    expect(mocks.deleteHolding).not.toHaveBeenCalled();
  });

  it('reports and notifies when the cleanup fails', async () => {
    mocks.getHoldingTransactions.mockResolvedValue({ total: 0 });
    mocks.deleteHolding.mockRejectedValue(new Error('boom'));
    const buy = setup();

    await buy.openBuy({ item });
    await closeDialog({ buy });

    expect(mocks.captureException).toHaveBeenCalled();
    expect(mocks.addErrorNotification).toHaveBeenCalledWith(expect.stringContaining('AAPL'));
    expect(buy.canBuy.value).toBe(true);
  });
});
