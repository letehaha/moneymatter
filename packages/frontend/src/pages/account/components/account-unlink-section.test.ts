import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type AccountModel } from '@bt/shared/types';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const { unlinkAccountFromBankConnection, addErrorNotification, addSuccessNotification, captureException } = vi.hoisted(
  () => ({
    unlinkAccountFromBankConnection: vi.fn(),
    addErrorNotification: vi.fn(),
    addSuccessNotification: vi.fn(),
    captureException: vi.fn(),
  }),
);

vi.mock('@/stores', () => ({ useAccountsStore: () => ({ unlinkAccountFromBankConnection }) }));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification, addSuccessNotification }),
}));
vi.mock('@/lib/sentry', () => ({ captureException }));
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/common/alert-dialog.vue', () => ({
  default: defineComponent({
    emits: ['accept'],
    setup(_, { emit, slots }) {
      return () => h('div', [slots.content?.(), h('button', { 'data-test': 'accept', onClick: () => emit('accept') })]);
    },
  }),
}));

import AccountUnlinkSection from './account-unlink-section.vue';

const account = { id: 'acc-1', name: 'Seam Bank', bankDataProviderConnectionId: 'conn-1' } as unknown as AccountModel;

const confirmUnlink = async () => {
  const wrapper = mount(AccountUnlinkSection, {
    props: { account },
    global: { stubs: { ClickToCopy: true }, mocks: { $t: (key: string) => key } },
  });
  await wrapper.find('input').setValue(account.name);
  await wrapper.find('[data-test="accept"]').trigger('click');
  await flushPromises();
};

describe('AccountUnlinkSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the API message when the unlink is refused', async () => {
    unlinkAccountFromBankConnection.mockRejectedValue(
      new ApiErrorResponseError('Import still running', {
        code: API_ERROR_CODES.locked,
        message: 'Import still running',
      }),
    );

    await confirmUnlink();

    expect(addErrorNotification).toHaveBeenCalledWith('Import still running');
    expect(captureException).not.toHaveBeenCalled();
  });

  it('falls back to the generic message and reports an unexpected error', async () => {
    const error = new TypeError('boom');
    unlinkAccountFromBankConnection.mockRejectedValue(error);

    await confirmUnlink();

    expect(addErrorNotification).toHaveBeenCalledWith('pages.account.unlink.error');
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ error }));
  });
});
