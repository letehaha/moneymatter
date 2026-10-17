import { mount } from '@vue/test-utils';

import FormattedAmountField from './formatted-amount-field.vue';

describe('FormattedAmountField decimals', () => {
  const mountField = ({ modelValue, decimals }: { modelValue: number | null; decimals?: number }) =>
    mount(FormattedAmountField, { props: { modelValue, decimals } });

  const type = async ({ wrapper, value }: { wrapper: ReturnType<typeof mountField>; value: string }) => {
    await wrapper.find('input').setValue(value);
  };

  it('shows up to three decimals for a 3-decimal currency', () => {
    const wrapper = mountField({ modelValue: 1.2345, decimals: 3 });

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('1.235');
  });

  it('shows no fraction for a whole-number currency', () => {
    const wrapper = mountField({ modelValue: 1500.6, decimals: 0 });

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('1,501');
  });

  it('shows a large VND value grouped', () => {
    const wrapper = mountField({ modelValue: 20_500_000_000, decimals: 0 });

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('20,500,000,000');
  });

  it('defaults to two decimals', () => {
    const wrapper = mountField({ modelValue: 1.2345 });

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('1.23');
  });

  it('emits three decimals typed into a 3-decimal currency', async () => {
    const wrapper = mountField({ modelValue: null, decimals: 3 });

    await type({ wrapper, value: '1.2345' });

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([1.234]);
  });

  it('emits a whole number when a fraction is typed into a whole-number currency', async () => {
    const wrapper = mountField({ modelValue: null, decimals: 0 });

    await type({ wrapper, value: '1500.6' });

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([1500]);
  });
});
