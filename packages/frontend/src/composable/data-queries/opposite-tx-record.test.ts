import { loadTransactionsByTransferId } from '@/api/transactions';
import { TRANSACTION_TRANSFER_NATURE, type TransactionModel } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Ref, defineComponent, ref } from 'vue';

import { useOppositeTxRecord } from './opposite-tx-record';

vi.mock('@/api/transactions', () => ({
  loadTransactionsByTransferId: vi.fn(),
}));

const mockLoadByTransferId = vi.mocked(loadTransactionsByTransferId);

interface TxSource {
  id: string;
  transferNature: TRANSACTION_TRANSFER_NATURE;
  transferId: string | null;
}

const makeTx = (id: string): TransactionModel => ({ id }) as unknown as TransactionModel;

const setup = (initial: TxSource, { enabled = ref(true) }: { enabled?: Ref<boolean> } = {}) => {
  const source = ref<TxSource>(initial) as Ref<TxSource>;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  let result: ReturnType<typeof useOppositeTxRecord> | undefined;

  const TestComponent = defineComponent({
    setup() {
      // Pass a getter so the query tracks the live source, mirroring how
      // transaction-record.vue passes `() => props.tx`.
      result = useOppositeTxRecord(() => source.value, { enabled });
      return {};
    },
    template: '<div />',
  });

  mount(TestComponent, {
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });

  return { source, getResult: () => result! };
};

const flushMicroTasks = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('useOppositeTxRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not hit the API while an out_of_wallet tx has no transferId (not yet linked)', async () => {
    setup({ id: 'tx-1', transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet, transferId: null });

    await flushMicroTasks();

    expect(mockLoadByTransferId).not.toHaveBeenCalled();
  });

  it('does not fetch for a non-transfer tx', async () => {
    setup({ id: 'tx-2', transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer, transferId: null });

    await flushMicroTasks();

    expect(mockLoadByTransferId).not.toHaveBeenCalled();
  });

  // Regression guard: a list row is reused (kept by :key) across an
  // out_of_wallet -> common_transfer transition when the user links it. A frozen
  // queryKey would never pick up the freshly-assigned transferId, so the opposite
  // leg (and therefore the Unlink affordance) would stay hidden until a full remount.
  it('fetches the opposite leg after the source flips to common_transfer with a transferId', async () => {
    const opposite = makeTx('tx-1-opposite');
    mockLoadByTransferId.mockResolvedValue([opposite, makeTx('tx-1')]);

    const { source, getResult } = setup({
      id: 'tx-1',
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      transferId: null,
    });

    await flushMicroTasks();
    expect(mockLoadByTransferId).not.toHaveBeenCalled();

    // Linking flips both legs to common_transfer and assigns a shared transferId.
    source.value = {
      id: 'tx-1',
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      transferId: 'transfer-1',
    };

    await vi.waitFor(() => {
      expect(mockLoadByTransferId).toHaveBeenCalledWith('transfer-1');
    });
    await vi.waitFor(() => {
      expect(getResult().data.value).toEqual(opposite);
    });
  });

  // Regression guard for the `enabled` flag: it must stay reactive. A tx that starts
  // as not_transfer (query disabled) and later becomes a transfer must begin fetching.
  it('re-enables and fetches when a previously non-transfer tx becomes a transfer', async () => {
    mockLoadByTransferId.mockResolvedValue([makeTx('tx-2-opposite'), makeTx('tx-2')]);

    const { source } = setup({
      id: 'tx-2',
      transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      transferId: null,
    });

    await flushMicroTasks();
    expect(mockLoadByTransferId).not.toHaveBeenCalled();

    source.value = {
      id: 'tx-2',
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      transferId: 'transfer-2',
    };

    await vi.waitFor(() => {
      expect(mockLoadByTransferId).toHaveBeenCalledWith('transfer-2');
    });
  });

  it('skips the lookup while the caller disables it, and fetches once re-enabled', async () => {
    mockLoadByTransferId.mockResolvedValue([makeTx('tx-3-opposite'), makeTx('tx-3')]);
    const enabled = ref(false);

    setup(
      { id: 'tx-3', transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer, transferId: 'transfer-3' },
      { enabled },
    );

    await flushMicroTasks();
    expect(mockLoadByTransferId).not.toHaveBeenCalled();

    enabled.value = true;

    await vi.waitFor(() => {
      expect(mockLoadByTransferId).toHaveBeenCalledWith('transfer-3');
    });
  });
});
