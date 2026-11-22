import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { useRatePair } from './use-rate-pair';

const setup = ({ isCustom = false }: { isCustom?: boolean } = {}) => {
  const pair = useRatePair({ saved: () => ({ baseRate: 4, quoteRate: 0.25 }), isCustom: () => isCustom });
  pair.resetPair();
  return pair;
};

describe('useRatePair', () => {
  it('starts from the saved pair, unchanged', async () => {
    const { form, isRateChanged, hasRateValue } = setup();
    await nextTick();

    expect(form).toEqual({ baseRate: 4, quoteRate: 0.25 });
    expect(isRateChanged.value).toBe(false);
    expect(hasRateValue.value).toBe(true);
  });

  it('derives the other side from the focused input only', async () => {
    const { form, editing, isRateChanged } = setup();

    editing.value = 'base';
    form.baseRate = 0.5;
    await nextTick();
    expect(form.quoteRate).toBe(2);
    expect(isRateChanged.value).toBe(true);

    editing.value = 'quote';
    form.quoteRate = 8;
    await nextTick();
    expect(form.baseRate).toBe(0.125);
  });

  it('keeps significant digits for a custom currency', async () => {
    const { form, editing } = setup({ isCustom: true });

    editing.value = 'quote';
    form.quoteRate = 3000000;
    await nextTick();

    expect(form.baseRate).toBe(3.33333333333e-7);
  });

  it('has no usable value when a side is empty', async () => {
    const { form, editing, hasRateValue } = setup();

    editing.value = 'base';
    form.baseRate = '';
    await nextTick();

    expect(hasRateValue.value).toBe(false);
  });

  it('resets to the saved pair without deriving from the reset values', async () => {
    const { form, editing, resetPair } = setup();
    editing.value = 'base';
    form.baseRate = 1;
    await nextTick();

    resetPair();
    await nextTick();

    expect(editing.value).toBeNull();
    expect(form).toEqual({ baseRate: 4, quoteRate: 0.25 });
  });
});
