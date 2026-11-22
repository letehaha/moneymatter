import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import CurrencyEditDialog from './currency-edit-dialog.vue';
import type { CurrencyWithExchangeRate } from './types';

const { mockRefresh, stub } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  // A child with two buttons per event it can emit: `<testId>-<event>` emits true, `<testId>-<event>-false` false.
  stub: async ({ testId, events = [], props = [] }: { testId: string; events?: string[]; props?: string[] }) => {
    const { defineComponent, h } = await import('vue');
    return {
      default: defineComponent({
        props,
        emits: events,
        setup:
          (componentProps, { emit }) =>
          () =>
            h('div', { 'data-testid': testId, 'data-props': JSON.stringify(componentProps) }, [
              ...events.flatMap((event) => [
                h('button', { 'data-testid': `${testId}-${event}`, onClick: () => emit(event, true) }),
                h('button', { 'data-testid': `${testId}-${event}-false`, onClick: () => emit(event, false) }),
              ]),
            ]),
      }),
    };
  },
}));

vi.mock('./use-refresh-after-currency-change', () => ({ useRefreshAfterCurrencyChange: () => mockRefresh }));

vi.mock('@/components/common/currency-icon.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return { default: defineComponent({ setup: () => () => h('span') }) };
});

vi.mock('./currency-dialog/rate-summary.vue', () => stub({ testId: 'rate-summary' }));
vi.mock('./currency-dialog/source-summary-row.vue', () => stub({ testId: 'source-summary-row', events: ['change'] }));
vi.mock('./currency-dialog/recent-rates.vue', () => stub({ testId: 'recent-rates', events: ['view-all'] }));
vi.mock('./currency-dialog/rate-history-view.vue', () => stub({ testId: 'rate-history-view' }));
vi.mock('./currency-dialog/rate-source-view.vue', () =>
  stub({ testId: 'rate-source-view', events: ['update:dirty', 'update:saving', 'saved', 'cancel'] }),
);
vi.mock('./currency-dialog/iso-rate-panel.vue', () =>
  stub({ testId: 'iso-rate-panel', events: ['submit', 'update:dirty'] }),
);
vi.mock('./currency-row/set-base-currency.vue', () => stub({ testId: 'set-base', events: ['submit'] }));
vi.mock('./currency-row/delete-currency.vue', () =>
  stub({ testId: 'delete-currency', events: ['submit'], props: ['accountsCount'] }),
);
vi.mock('./custom-currency-dialog.vue', () => stub({ testId: 'custom-currency-dialog' }));

vi.mock('./currency-dialog/discard-changes-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: { open: Boolean, code: String, currentSourceText: String },
      emits: ['update:open', 'discard'],
      setup:
        (props, { emit }) =>
        () =>
          props.open
            ? h('div', { 'data-testid': 'discard-dialog' }, [
                props.currentSourceText ?? 'unsaved rate',
                h('button', { 'data-testid': 'discard-keep', onClick: () => emit('update:open', false) }),
                h('button', {
                  'data-testid': 'discard-confirm',
                  onClick: () => {
                    emit('update:open', false);
                    emit('discard');
                  },
                }),
              ])
            : null,
    }),
  };
});

// Mirrors the real dialog: a close attempt while not dismissible emits `dismiss-blocked` instead.
vi.mock('@/components/common/responsive-dialog.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: { open: Boolean, dismissible: { type: Boolean, default: true } },
      emits: ['update:open', 'dismiss-blocked'],
      setup:
        (props, { slots, emit }) =>
        () =>
          props.open
            ? h('div', { 'data-testid': 'edit-dialog' }, [
                h('button', {
                  'data-testid': 'dialog-close',
                  onClick: () => (props.dismissible ? emit('update:open', false) : emit('dismiss-blocked')),
                }),
                slots.title?.(),
                slots.default?.(),
              ])
            : null,
    }),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { settings: { currencies: { dialog: { source: { manual: 'You enter it yourself' } } } } } },
});

const TETHER = {
  id: 1,
  currencyCode: 'USDT',
  name: 'Tether',
  currency: { code: 'USDT', currency: 'Tether', digits: 2, symbol: null, isCustom: true },
  isCustomCurrency: true,
  rateSource: 'manual',
  rateSourceConfig: null,
  quoteCode: 'USD',
  rate: 1,
  quoteRate: 1,
};

const EURO = {
  ...TETHER,
  id: 2,
  currencyCode: 'EUR',
  name: 'Euro',
  currency: { code: 'EUR', currency: 'Euro', digits: 2, symbol: null, isCustom: false },
  isCustomCurrency: false,
};

const mountDialog = ({ currency = TETHER, accountsCount = 0 }: { currency?: object; accountsCount?: number } = {}) =>
  mount(CurrencyEditDialog, {
    props: {
      open: true,
      currency: currency as unknown as CurrencyWithExchangeRate,
      accountsCount,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
    global: { plugins: [i18n] },
  });
let wrapper: VueWrapper;

const click = async (testId: string) => {
  await wrapper.get(`[data-testid="${testId}"]`).trigger('click');
  await flushPromises();
};
const exists = (testId: string) => wrapper.find(`[data-testid="${testId}"]`).exists();
const isOpen = () => exists('edit-dialog');

const openDirtySource = async () => {
  await click('source-summary-row-change');
  await click('rate-source-view-update:dirty');
};

describe('CurrencyEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a custom currency with its rate, its source and recent rates', () => {
    wrapper = mountDialog();

    expect(exists('currency-dialog-overview')).toBe(true);
    expect(exists('rate-summary')).toBe(true);
    expect(exists('source-summary-row')).toBe(true);
    expect(exists('recent-rates')).toBe(true);
    expect(exists('edit-custom-currency')).toBe(true);
    expect(exists('iso-rate-panel')).toBe(false);
    expect(exists('set-base')).toBe(false);
  });

  it('shows an ISO currency with its live-rate panel and base-currency action', () => {
    wrapper = mountDialog({ currency: EURO, accountsCount: 2 });

    expect(exists('iso-rate-panel')).toBe(true);
    expect(exists('set-base')).toBe(true);
    expect(exists('source-summary-row')).toBe(false);
    expect(JSON.parse(wrapper.get('[data-testid="delete-currency"]').attributes('data-props')!)).toEqual({
      accountsCount: 2,
    });
  });

  it('pushes the history view and comes back to the overview', async () => {
    wrapper = mountDialog();

    await click('recent-rates-view-all');
    expect(exists('rate-history-view')).toBe(true);
    expect(wrapper.get('[data-testid="edit-dialog"]').text()).toContain('Tether');

    await click('currency-dialog-back');
    expect(exists('currency-dialog-overview')).toBe(true);
  });

  it('returns to the overview once the source is saved or cancelled', async () => {
    wrapper = mountDialog();

    await openDirtySource();
    await click('rate-source-view-saved');
    expect(exists('currency-dialog-overview')).toBe(true);

    await click('dialog-close');
    expect(isOpen()).toBe(false);
  });

  it('asks before the back button drops a source draft, and stays when the user keeps editing', async () => {
    wrapper = mountDialog();
    await openDirtySource();

    await click('currency-dialog-back');
    expect(wrapper.get('[data-testid="discard-dialog"]').text()).toBe('You enter it yourself');

    await click('discard-keep');
    expect(exists('rate-source-view')).toBe(true);

    await click('currency-dialog-back');
    await click('discard-confirm');
    expect(exists('currency-dialog-overview')).toBe(true);
  });

  it('asks before a close drops a source draft, and closes once discarded', async () => {
    wrapper = mountDialog();
    await openDirtySource();

    await click('dialog-close');
    expect(isOpen()).toBe(true);
    expect(exists('discard-dialog')).toBe(true);

    await click('discard-confirm');
    expect(isOpen()).toBe(false);
  });

  it('blocks leaving without offering discard while the source save runs', async () => {
    wrapper = mountDialog();
    await openDirtySource();
    await click('rate-source-view-update:saving');

    expect(wrapper.get('[data-testid="currency-dialog-back"]').attributes('disabled')).toBeDefined();
    await click('dialog-close');

    expect(isOpen()).toBe(true);
    expect(exists('discard-dialog')).toBe(false);
    expect(exists('rate-source-view')).toBe(true);
  });

  it('lets the user leave again once the source save stops', async () => {
    wrapper = mountDialog();
    await openDirtySource();
    await click('rate-source-view-update:saving');
    await click('rate-source-view-update:saving-false');

    expect(wrapper.get('[data-testid="currency-dialog-back"]').attributes('disabled')).toBeUndefined();
    await click('dialog-close');
    expect(exists('discard-dialog')).toBe(true);

    await click('discard-keep');
    await click('currency-dialog-back');
    expect(exists('discard-dialog')).toBe(true);
  });

  it('leaves without asking once the source draft is clean again', async () => {
    wrapper = mountDialog();
    await openDirtySource();
    await click('rate-source-view-update:dirty-false');

    await click('currency-dialog-back');
    expect(exists('discard-dialog')).toBe(false);
    expect(exists('currency-dialog-overview')).toBe(true);

    await click('source-summary-row-change');
    await click('rate-source-view-update:dirty');
    await click('rate-source-view-update:dirty-false');
    await click('dialog-close');
    expect(isOpen()).toBe(false);
  });

  it('asks before a close drops an unsaved ISO rate, and opens clean again', async () => {
    wrapper = mountDialog({ currency: EURO });
    await click('iso-rate-panel-update:dirty');

    await click('dialog-close');
    expect(isOpen()).toBe(true);
    expect(wrapper.get('[data-testid="discard-dialog"]').text()).toBe('unsaved rate');

    await click('discard-confirm');
    expect(isOpen()).toBe(false);

    await wrapper.setProps({ open: true });
    await click('dialog-close');
    expect(isOpen()).toBe(false);
  });

  it('closes without asking when the source view is unchanged', async () => {
    wrapper = mountDialog();

    await click('source-summary-row-change');
    await click('dialog-close');

    expect(isOpen()).toBe(false);
    expect(exists('discard-dialog')).toBe(false);
  });

  it('opens on the overview again after closing on a pushed view', async () => {
    wrapper = mountDialog();
    await click('recent-rates-view-all');

    await click('dialog-close');
    await wrapper.setProps({ open: true });

    expect(exists('currency-dialog-overview')).toBe(true);
  });

  it.each(['iso-rate-panel', 'set-base', 'delete-currency'])(
    'closes and refreshes after %s submits',
    async (testId) => {
      wrapper = mountDialog({ currency: EURO });

      await click(`${testId}-submit`);

      expect(isOpen()).toBe(false);
      expect(mockRefresh).toHaveBeenCalledOnce();
    },
  );
});
