import type { CurrencyModel, TransactionOptionalField } from '@bt/shared/types';
import { nextTick, ref } from 'vue';

import type { UI_FORM_STRUCT } from '../types';
import { type MountableField, useFieldReveal } from './use-field-reveal';

const setup = ({
  form = {},
  isMobileView = true,
  isSavedTransaction = false,
  isTransferTx = false,
  isRefundAvailable = true,
  isRefundLinked = false,
  disabledFields = [],
}: {
  form?: Partial<UI_FORM_STRUCT>;
  isMobileView?: boolean;
  isSavedTransaction?: boolean;
  isTransferTx?: boolean;
  isRefundAvailable?: boolean;
  isRefundLinked?: boolean;
  disabledFields?: TransactionOptionalField[];
} = {}) => {
  const formRef = ref({ tagIds: [], ...form } as UI_FORM_STRUCT);
  const onLinkRefund = vi.fn();
  const reveal = useFieldReveal({
    form: formRef,
    hasPendingAttachments: false,
    isMobileView,
    isSavedTransaction,
    isTransferTx,
    isLoanDestination: false,
    isAttachmentsAvailable: true,
    isRefundAvailable,
    isRefundLinked,
    isOptionalFieldEnabled: (field) => !disabledFields.includes(field),
    onLinkRefund,
    onReveal: vi.fn(),
  });
  const chipKeys = () => reveal.chips.value.map((chip) => chip.key);
  return { ...reveal, form: formRef, onLinkRefund, chipKeys };
};

describe('useFieldReveal', () => {
  it('offers every chip in order on an empty mobile form', () => {
    expect(setup().chipKeys()).toEqual([
      'tags',
      'attachments',
      'externalUrl',
      'externalReference',
      'location',
      'originalAmount',
      'excludeFromStats',
      'refund',
    ]);
  });

  it('hides the chip of a disabled setting', () => {
    const { chipKeys, shown } = setup({ disabledFields: ['location'] });
    expect(chipKeys()).not.toContain('location');
    expect(shown.value.location).toBe(false);
  });

  it.each<[MountableField, Partial<UI_FORM_STRUCT>]>([
    ['tags', { tagIds: ['t1'] }],
    ['externalUrl', { externalUrl: 'https://example.com' }],
    ['externalReference', { externalReference: 'INV-1' }],
    ['location', { latitude: 50.45, longitude: 30.52 }],
    ['originalAmount', { originalAmount: 40 }],
    ['originalAmount', { originalAmount: null, originalCurrency: { code: 'EUR' } as CurrencyModel }],
  ])('shows %s with a value and offers no chip for it', (field, form) => {
    const { chipKeys, shown } = setup({ form });
    expect(shown.value[field]).toBe(true);
    expect(chipKeys()).not.toContain(field);
  });

  it('keeps a field shown after its value is cleared', async () => {
    const { form, shown } = setup({ form: { latitude: 50.45, longitude: 30.52 } });
    form.value.latitude = null;
    form.value.longitude = null;
    await nextTick();
    expect(shown.value.location).toBe(true);
  });

  it('offers no excludeFromStats chip on transfers', () => {
    const { chipKeys, shown } = setup({ isTransferTx: true });
    expect(chipKeys()).not.toContain('excludeFromStats');
    expect(shown.value.excludeFromStats).toBe(false);
  });

  it('mounting excludeFromStats turns the switch on and removes its chip', () => {
    const { chipKeys, form, mount, shown } = setup();
    mount({ field: 'excludeFromStats' });
    expect(shown.value.excludeFromStats).toBe(true);
    expect(form.value.excludeFromStats).toBe(true);
    expect(chipKeys()).not.toContain('excludeFromStats');
  });

  it('offers no originalAmount chip on transfers', () => {
    expect(setup({ isTransferTx: true }).chipKeys()).not.toContain('originalAmount');
  });

  it('shows an already excluded transaction without offering the chip', () => {
    const { chipKeys, shown } = setup({ form: { excludeFromStats: true } });
    expect(shown.value.excludeFromStats).toBe(true);
    expect(chipKeys()).not.toContain('excludeFromStats');
  });

  it.each([
    ['unavailable', { isRefundAvailable: false }],
    ['already linked', { isRefundLinked: true }],
  ])('offers no refund chip when %s', (_, options) => {
    expect(setup(options).chipKeys()).not.toContain('refund');
  });

  it('links a refund through the refund chip', () => {
    const { chips, onLinkRefund } = setup();
    chips.value.find((chip) => chip.key === 'refund')!.onClick();
    expect(onLinkRefund).toHaveBeenCalledOnce();
  });

  it('never offers tags/attachments chips on desktop', () => {
    const { chipKeys, shown } = setup({ isMobileView: false });
    expect(chipKeys()).not.toContain('tags');
    expect(chipKeys()).not.toContain('attachments');
    expect(shown.value.tags && shown.value.attachments).toBe(true);
  });

  it('shows attachments of a saved transaction on mobile without a chip', () => {
    const { chipKeys, shown } = setup({ isSavedTransaction: true });
    expect(shown.value.attachments).toBe(true);
    expect(chipKeys()).not.toContain('attachments');
  });

  it('mount shows the field and removes its chip', () => {
    const { chipKeys, mount, shown } = setup();
    mount({ field: 'externalUrl' });
    expect(shown.value.externalUrl).toBe(true);
    expect(chipKeys()).not.toContain('externalUrl');
  });
});
