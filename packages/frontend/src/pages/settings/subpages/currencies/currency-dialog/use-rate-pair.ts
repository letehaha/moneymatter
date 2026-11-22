import { computed, reactive, ref, watch } from 'vue';

import { calculateRatio } from '../currency-row/calculate-ratio';

interface SavedPair {
  baseRate: number;
  quoteRate: number;
}

/** The two inputs of one rate pair: `baseRate` is 1 {code} in the quote currency, `quoteRate` its inverse. */
export const useRatePair = ({ saved, isCustom }: { saved: () => SavedPair; isCustom: () => boolean }) => {
  const form = reactive<{ baseRate: number | string; quoteRate: number | string }>({ baseRate: '', quoteRate: '' });
  // The focused input; typing in it derives the other one.
  const editing = ref<'base' | 'quote' | null>(null);

  watch(
    () => form.baseRate,
    (value) => {
      if (editing.value === 'base') form.quoteRate = calculateRatio({ value, isCustom: isCustom() });
    },
  );
  watch(
    () => form.quoteRate,
    (value) => {
      if (editing.value === 'quote') form.baseRate = calculateRatio({ value, isCustom: isCustom() });
    },
  );

  const isRateChanged = computed(() => {
    const { baseRate, quoteRate } = saved();
    return +baseRate !== +form.baseRate || +quoteRate !== +form.quoteRate;
  });
  const hasRateValue = computed(() => Number(form.baseRate) > 0 && Number(form.quoteRate) > 0);

  const resetPair = () => {
    editing.value = null;
    Object.assign(form, saved());
  };

  return { form, editing, isRateChanged, hasRateValue, resetPair };
};
