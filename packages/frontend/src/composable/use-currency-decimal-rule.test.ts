import { mount } from '@vue/test-utils';
import { computed, defineComponent, nextTick, ref } from 'vue';
import { createI18n } from 'vue-i18n';

import { useFormValidation } from './form-validator';
import { useCurrencyDecimalRule } from './use-currency-decimal-rule';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      forms: {
        validators: {
          invalidCurrencyDecimal: 'unused | {decimals} decimal | {decimals} decimals',
          invalidCurrencyWholeAmount: 'whole amount',
        },
      },
    },
  },
  missingWarn: false,
  fallbackWarn: false,
});

const setup = ({
  amount,
  decimals,
  staticRules = false,
}: {
  amount: number | string | null;
  decimals: number | undefined;
  staticRules?: boolean;
}) => {
  let exposed!: {
    form: ReturnType<typeof ref<{ amount: number | string | null }>>;
    decimals: ReturnType<typeof ref<number | undefined>>;
    rule: ReturnType<typeof useCurrencyDecimalRule>;
    validation: ReturnType<typeof useFormValidation>;
  };
  mount(
    defineComponent({
      setup() {
        const form = ref({ amount });
        const decimalsRef = ref(decimals);
        const rule = useCurrencyDecimalRule({ decimals: decimalsRef });
        const buildRules = () => ({ form: { amount: { currencyDecimal: rule.rule.value } } });
        const validation = useFormValidation({ form }, staticRules ? buildRules() : computed(buildRules), undefined, {
          customValidationMessages: { currencyDecimal: rule.message },
        });
        exposed = { form, decimals: decimalsRef, rule, validation };
        return () => null;
      },
    }),
    { global: { plugins: [i18n] } },
  );
  return exposed;
};

describe('useCurrencyDecimalRule', () => {
  it.each<[number | string | null]>([[null], ['']])('passes an empty value %o', (amount) => {
    const { rule } = setup({ amount, decimals: 2 });

    expect(rule.isValid(amount)).toBe(true);
  });

  it('passes any value while the currency is unknown', () => {
    const { rule } = setup({ amount: 1.23456, decimals: undefined });

    expect(rule.isValid(1.23456)).toBe(true);
  });

  it('asks for a whole amount at 0 decimals', () => {
    const { rule } = setup({ amount: 10.5, decimals: 0 });

    expect(rule.isValid(10.5)).toBe(false);
    expect(rule.message.value).toBe('whole amount');
  });

  it('names the decimals count above 0', () => {
    const { rule } = setup({ amount: 1.234, decimals: 2 });

    expect(rule.isValid(1.234)).toBe(false);
    expect(rule.message.value).toBe('2 decimals');
  });

  it.each<[string, boolean]>([
    ['computed', false],
    ['static', true],
  ])('shows the error on a touched field after the decimals drop (%s rules)', async (_, staticRules) => {
    const { decimals, validation } = setup({ amount: 10.99, decimals: 2, staticRules });

    validation.touchField('form.amount');
    expect(validation.getFieldErrorMessage('form.amount')).toBe('');

    decimals.value = 0;
    await nextTick();

    expect(validation.getFieldErrorMessage('form.amount')).toBe('whole amount');
    expect(validation.isFormValid()).toBe(false);
  });
});
