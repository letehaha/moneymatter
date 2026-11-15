import { flushPromises, mount } from '@vue/test-utils';

import FormattedAmountField from './formatted-amount-field.vue';

// The field formats with the runtime locale; pin it so the expected strings hold on any machine.
const RealNumberFormat = Intl.NumberFormat;

beforeAll(() => {
  vi.spyOn(Intl, 'NumberFormat').mockImplementation(function (
    locale?: string | string[],
    options?: Intl.NumberFormatOptions,
  ) {
    return new RealNumberFormat(locale ?? 'en-US', options);
  } as unknown as typeof Intl.NumberFormat);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('FormattedAmountField decimals', () => {
  const mountField = ({ modelValue, decimals }: { modelValue: number | null; decimals: number }) =>
    mount(FormattedAmountField, {
      props: {
        modelValue,
        decimals,
        'onUpdate:modelValue': (value: number | null) => wrapper.setProps({ modelValue: value }),
      },
    });
  let wrapper: ReturnType<typeof mountField>;

  const inputValue = () => (wrapper.find('input').element as HTMLInputElement).value;

  const type = async ({ value }: { value: string }) => {
    await wrapper.find('input').setValue(value);
    await flushPromises();
  };

  it('shows up to three decimals for a 3-decimal currency', () => {
    wrapper = mountField({ modelValue: 1.2345, decimals: 3 });

    expect(inputValue()).toBe('1.235');
  });

  it('shows no fraction for a whole-number currency', () => {
    wrapper = mountField({ modelValue: 1500.6, decimals: 0 });

    expect(inputValue()).toBe('1,501');
  });

  it('shows a large VND value grouped', () => {
    wrapper = mountField({ modelValue: 20_500_000_000, decimals: 0 });

    expect(inputValue()).toBe('20,500,000,000');
  });

  it('emits three decimals typed into a 3-decimal currency', async () => {
    wrapper = mountField({ modelValue: null, decimals: 3 });

    await type({ value: '1.2345' });

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([1.234]);
  });

  it('emits a whole number when a fraction is typed into a whole-number currency', async () => {
    wrapper = mountField({ modelValue: null, decimals: 0 });

    await type({ value: '1500.6' });

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([1500]);
  });

  it('rewrites the input when a dropped digit leaves the value unchanged', async () => {
    wrapper = mountField({ modelValue: 1500, decimals: 0 });

    await type({ value: '1,500.6' });

    expect(inputValue()).toBe('1,500');
    expect(wrapper.props('modelValue')).toBe(1500);
  });

  it('rewrites the input when a fourth digit is typed into a 3-decimal amount', async () => {
    wrapper = mountField({ modelValue: 1.234, decimals: 3 });

    await type({ value: '1.2345' });

    expect(inputValue()).toBe('1.234');
    expect(wrapper.props('modelValue')).toBe(1.234);
  });

  it('re-emits the value cut to the new decimals when they shrink', async () => {
    wrapper = mountField({ modelValue: 1000.555, decimals: 3 });

    await wrapper.setProps({ decimals: 2 });
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([1000.55]);
    expect(inputValue()).toBe('1,000.55');
  });

  it('re-emits a whole number when the decimals drop to zero', async () => {
    wrapper = mountField({ modelValue: 10.5, decimals: 2 });

    await wrapper.setProps({ decimals: 0 });
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([10]);
    expect(inputValue()).toBe('10');
  });

  it('emits nothing when the value already fits the new decimals', async () => {
    wrapper = mountField({ modelValue: 10.5, decimals: 3 });

    await wrapper.setProps({ decimals: 2 });
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
