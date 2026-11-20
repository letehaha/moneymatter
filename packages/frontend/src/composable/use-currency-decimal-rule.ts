import * as validators from '@/js/helpers/validators';
import { helpers } from '@vuelidate/validators';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';
import { type ComposerTranslation, useI18n } from 'vue-i18n';

export const getCurrencyDecimalMessage = ({ t, decimals }: { t: ComposerTranslation; decimals: number }): string =>
  decimals === 0
    ? t('forms.validators.invalidCurrencyWholeAmount')
    : t('forms.validators.invalidCurrencyDecimal', { decimals }, decimals);

/**
 * The "no more decimals than the currency stores" rule and its message. Typing is
 * capped to the decimals, so the rule catches a prefilled value or a currency switch
 * to fewer decimals. Empty values and an unknown currency pass; `required` covers them.
 */
export const useCurrencyDecimalRule = ({ decimals }: { decimals: MaybeRefOrGetter<number | undefined> }) => {
  const { t } = useI18n();

  const isValid = (value: unknown): boolean => {
    const current = toValue(decimals);
    return current === undefined || !helpers.req(value) || validators.maxDecimalPoints(current)(value as number);
  };

  return {
    isValid,
    // The decimals param makes vuelidate drop its cached result when the currency changes.
    rule: computed(() => helpers.withParams({ decimals: toValue(decimals) }, isValid)),
    message: computed(() => getCurrencyDecimalMessage({ t, decimals: toValue(decimals) ?? 0 })),
  };
};
