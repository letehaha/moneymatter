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

  it('shows every digit of a model with more decimals than the currency', () => {
    wrapper = mountField({ modelValue: 1500.6, decimals: 0 });

    expect(inputValue()).toBe('1,500.6');
  });

  it('drops float noise from a computed model', () => {
    wrapper = mountField({ modelValue: 0.1 + 0.2, decimals: 2 });

    expect(inputValue()).toBe('0.3');
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

  it.each<[number | null]>([[null], [12]])('keeps a lone decimal separator typed over %s', async (modelValue) => {
    wrapper = mountField({ modelValue, decimals: 2 });

    await type({ value: '.' });

    expect(inputValue()).toBe('.');

    await type({ value: '.5' });

    expect(wrapper.props('modelValue')).toBe(0.5);
    expect(inputValue()).toBe('0.5');
    expect((wrapper.find('input').element as HTMLInputElement).selectionStart).toBe(3);
  });

  it('drops a lone decimal separator in a whole-number currency', async () => {
    wrapper = mountField({ modelValue: null, decimals: 0 });

    await type({ value: '.' });

    expect(inputValue()).toBe('');
  });

  it('keeps the value when the decimals drop', async () => {
    wrapper = mountField({ modelValue: 10.99, decimals: 2 });

    await wrapper.setProps({ decimals: 0 });
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(inputValue()).toBe('10.99');
  });
});
