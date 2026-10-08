import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';

import { useAutoTagApply } from './use-auto-tag-apply';

const setup = (initialTagIds: string[] = []) => {
  const tagIds = ref<string[]>(initialTagIds);
  const payeeId = ref<string | null>(null);
  const categoryId = ref<string | null>(null);
  const isTransfer = ref(false);
  const { apply, reset } = useAutoTagApply({
    tagIds,
    sources: { payee: () => payeeId.value, category: () => categoryId.value },
    suspended: { category: () => isTransfer.value },
  });
  const setTransfer = async (value: boolean) => {
    isTransfer.value = value;
    await nextTick();
  };
  return { tagIds, payeeId, categoryId, apply, reset, setTransfer };
};

describe('useAutoTagApply', () => {
  it('switching category removes only what the previous category auto-added', () => {
    const { tagIds, apply } = setup(['manual']);
    apply({ source: 'category', autoTagIds: ['c1'] });
    expect(tagIds.value).toEqual(['manual', 'c1']);
    apply({ source: 'category', autoTagIds: ['c2'] });
    expect(tagIds.value).toEqual(['manual', 'c2']);
  });

  it('never removes tags that were on the form before the first apply', () => {
    const { tagIds, apply } = setup(['saved']);
    apply({ source: 'category', autoTagIds: ['saved', 'c1'] });
    apply({ source: 'category', autoTagIds: [] });
    expect(tagIds.value).toEqual(['saved']);
  });

  it('keeps a hand-removed auto tag removed until the source changes again', () => {
    const { tagIds, apply } = setup();
    apply({ source: 'category', autoTagIds: ['c1', 'c2'] });
    tagIds.value = ['c1'];
    apply({ source: 'payee', autoTagIds: ['p1'] });
    expect(tagIds.value).toEqual(['c1', 'p1']);
    apply({ source: 'category', autoTagIds: ['c1', 'c2'] });
    expect(tagIds.value).toEqual(['p1', 'c1', 'c2']);
  });

  it('tracks payee and category independently and keeps a tag both supply', () => {
    const { tagIds, apply } = setup();
    apply({ source: 'payee', autoTagIds: ['shared', 'p1'] });
    apply({ source: 'category', autoTagIds: ['shared', 'c1'] });
    expect(tagIds.value).toEqual(['shared', 'p1', 'c1']);

    apply({ source: 'payee', autoTagIds: [] });
    expect(tagIds.value).toEqual(['shared', 'c1']);

    apply({ source: 'category', autoTagIds: [] });
    expect(tagIds.value).toEqual([]);
  });

  it('retracts a source when its id is cleared', async () => {
    const { tagIds, payeeId, apply } = setup(['manual']);
    payeeId.value = 'payee-1';
    await nextTick();
    apply({ source: 'payee', autoTagIds: ['p1'] });
    payeeId.value = null;
    await nextTick();
    expect(tagIds.value).toEqual(['manual']);
  });

  it('reset forgets tracking so the next apply only adds', () => {
    const { tagIds, apply, reset } = setup();
    apply({ source: 'category', autoTagIds: ['c1'] });
    reset();
    apply({ source: 'category', autoTagIds: ['c2'] });
    expect(tagIds.value).toEqual(['c1', 'c2']);
  });

  describe('suspended source', () => {
    it('retracts on suspend and restores the same tags on resume', async () => {
      const { tagIds, apply, setTransfer } = setup();
      apply({ source: 'category', autoTagIds: ['c1'] });
      await setTransfer(true);
      expect(tagIds.value).toEqual([]);
      await setTransfer(false);
      expect(tagIds.value).toEqual(['c1']);

      apply({ source: 'category', autoTagIds: [] });
      expect(tagIds.value).toEqual([]);
    });

    it('does not bring back an auto tag the user removed by hand', async () => {
      const { tagIds, apply, setTransfer } = setup();
      apply({ source: 'category', autoTagIds: ['c1', 'c2'] });
      tagIds.value = ['c2'];
      await setTransfer(true);
      await setTransfer(false);
      expect(tagIds.value).toEqual(['c2']);
    });

    it('adds nothing when the source never applied', async () => {
      const { tagIds, categoryId, setTransfer } = setup(['saved']);
      categoryId.value = 'category-1';
      await setTransfer(true);
      await setTransfer(false);
      expect(tagIds.value).toEqual(['saved']);
    });

    it('keeps manual, pre-existing and payee tags through the round trip', async () => {
      const { tagIds, apply, setTransfer } = setup(['saved']);
      apply({ source: 'payee', autoTagIds: ['shared', 'p1'] });
      apply({ source: 'category', autoTagIds: ['saved', 'shared', 'c1'] });
      tagIds.value = [...tagIds.value, 'manual'];

      await setTransfer(true);
      expect(tagIds.value).toEqual(['saved', 'shared', 'p1', 'manual']);
      await setTransfer(false);
      expect(tagIds.value).toEqual(['saved', 'shared', 'p1', 'manual', 'c1']);
    });

    it('holds an apply made while suspended until resume, replacing what was retracted', async () => {
      const { tagIds, apply, setTransfer } = setup();
      apply({ source: 'category', autoTagIds: ['c1'] });
      await setTransfer(true);
      apply({ source: 'category', autoTagIds: ['c2'] });
      expect(tagIds.value).toEqual([]);
      await setTransfer(false);
      expect(tagIds.value).toEqual(['c2']);
    });

    it('restores nothing once the source id was cleared or tracking was reset', async () => {
      const { tagIds, categoryId, apply, reset, setTransfer } = setup();
      categoryId.value = 'category-1';
      await nextTick();
      apply({ source: 'category', autoTagIds: ['c1'] });
      await setTransfer(true);
      categoryId.value = null;
      await setTransfer(false);
      expect(tagIds.value).toEqual([]);

      apply({ source: 'category', autoTagIds: ['c1'] });
      await setTransfer(true);
      reset();
      await setTransfer(false);
      expect(tagIds.value).toEqual([]);
    });
  });
});
