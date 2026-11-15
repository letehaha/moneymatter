import * as validators from '@/js/helpers/validators';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * The "no more decimals than the currency stores" rule and its message, for an amount
 * field the form seeds from a stored value. Typed digits past the decimals are already
 * dropped by the input, so only a prefilled value can break the rule.
 */
export const useCurrencyDecimalRule = ({ decimals }: { decimals: MaybeRefOrGetter<number> }) => {
  const { t } = useI18n();

  return {
    rule: computed(() => validators.maxDecimalPoints(toValue(decimals))),
    message: computed(() =>
      t('forms.validators.invalidCurrencyDecimal', { decimals: toValue(decimals) }, toValue(decimals)),
    ),
  };
};
