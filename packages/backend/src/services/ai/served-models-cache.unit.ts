import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SERVED_MODELS_TTL_MS, clearServedModelsCache, getCachedServedModels } from './served-models-cache';

describe('getCachedServedModels', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clearServedModelsCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists once per key within the TTL', async () => {
    const load = jest.fn<() => Promise<string[]>>().mockResolvedValue(['a', 'b']);

    expect(await getCachedServedModels({ key: 'c1', load })).toEqual(['a', 'b']);
    expect(await getCachedServedModels({ key: 'c1', load })).toEqual(['a', 'b']);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('lists again once the TTL has passed', async () => {
    const load = jest.fn<() => Promise<string[]>>().mockResolvedValue(['a']);
    await getCachedServedModels({ key: 'c1', load });

    jest.advanceTimersByTime(SERVED_MODELS_TTL_MS + 1);
    await getCachedServedModels({ key: 'c1', load });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps one entry per key', async () => {
    const load = jest.fn<() => Promise<string[]>>().mockResolvedValue(['a']);

    await getCachedServedModels({ key: 'c1', load });
    await getCachedServedModels({ key: 'c2', load });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not remember an empty list, because a provider that lists nothing may just be unreachable', async () => {
    const load = jest.fn<() => Promise<string[]>>().mockResolvedValue([]);

    expect(await getCachedServedModels({ key: 'c1', load })).toEqual([]);
    await getCachedServedModels({ key: 'c1', load });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failure', async () => {
    const load = jest
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValue(['a']);

    await expect(getCachedServedModels({ key: 'c1', load })).rejects.toThrow('blocked');
    expect(await getCachedServedModels({ key: 'c1', load })).toEqual(['a']);
  });
});
