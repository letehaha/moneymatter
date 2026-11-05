import { effectScope, nextTick, ref } from 'vue';

import { useFittingChips } from './use-fitting-chips';

const listWithChipsAt = (tops: number[]) => {
  const list = document.createElement('div');
  for (const top of tops) {
    const chip = document.createElement('span');
    Object.defineProperty(chip, 'offsetTop', { value: top });
    list.append(chip);
  }
  return list;
};

const setup = () => {
  const items = ref<number[]>([]);
  const result = effectScope().run(() => useFittingChips({ items }))!;
  return { items, ...result };
};

describe('useFittingChips', () => {
  it('counts chips wrapped past the first line as hidden', async () => {
    const { items, setListRef, hiddenCount } = setup();
    setListRef(listWithChipsAt([0, 0, 24, 24, 48]));
    items.value = [1, 2, 3, 4, 5];
    await nextTick();

    expect(hiddenCount.value).toBe(3);
  });

  it('hides nothing when every chip fits on the first line', async () => {
    const { items, setListRef, hiddenCount } = setup();
    setListRef(listWithChipsAt([0, 0, 0]));
    items.value = [1, 2, 3];
    await nextTick();

    expect(hiddenCount.value).toBe(0);
  });

  it('re-measures when the items change', async () => {
    const { items, setListRef, hiddenCount } = setup();
    setListRef(listWithChipsAt([0, 24]));
    items.value = [1, 2];
    await nextTick();
    expect(hiddenCount.value).toBe(1);

    setListRef(listWithChipsAt([0, 0]));
    items.value = [3, 4];
    await nextTick();
    expect(hiddenCount.value).toBe(0);
  });
});
