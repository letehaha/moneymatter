import { api } from '@/api/_api';
import { AI_FEATURE } from '@bt/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setAiFeatureConfig } from './ai-settings';

vi.mock('@/api/_api', () => ({ api: { put: vi.fn() } }));

describe('setAiFeatureConfig', () => {
  beforeEach(() => {
    vi.mocked(api.put).mockReset();
  });

  it('sends the model next to the connection', async () => {
    await setAiFeatureConfig({ feature: AI_FEATURE.categorization, connectionId: 'c1', modelId: 'claude-haiku-5-5' });

    expect(api.put).toHaveBeenCalledWith('/user/settings/ai/features/categorization', {
      connectionId: 'c1',
      modelId: 'claude-haiku-5-5',
    });
  });

  it('leaves the model out for the connection default, which also clears a stored one', async () => {
    await setAiFeatureConfig({ feature: AI_FEATURE.categorization, connectionId: 'c1' });
    await setAiFeatureConfig({ feature: AI_FEATURE.categorization, connectionId: null });

    expect(vi.mocked(api.put).mock.calls.map(([, body]) => body)).toEqual([
      { connectionId: 'c1' },
      { connectionId: null },
    ]);
  });
});
