import { AI_PROVIDER, type CliAiAvailability } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  AI_CONNECTION_PRESETS,
  findPresetForConnection,
  getVisiblePresets,
  isSubscriptionPreset,
  matchPresetByBaseUrl,
} from './presets';

describe('matchPresetByBaseUrl', () => {
  it('matches a preset base URL exactly', () => {
    expect(matchPresetByBaseUrl({ baseUrl: 'https://openrouter.ai/api/v1' })?.id).toBe('openrouter');
  });

  it('ignores case, surrounding spaces and trailing slashes', () => {
    expect(matchPresetByBaseUrl({ baseUrl: '  HTTPS://OpenRouter.ai/api/v1//  ' })?.id).toBe('openrouter');
  });

  it('treats 127.0.0.1 and localhost as the same host', () => {
    expect(matchPresetByBaseUrl({ baseUrl: 'http://127.0.0.1:11434/v1' })?.id).toBe('ollama');
    expect(matchPresetByBaseUrl({ baseUrl: 'http://localhost:1234/v1/' })?.id).toBe('lmStudio');
  });

  it('returns null for a URL no preset uses', () => {
    expect(matchPresetByBaseUrl({ baseUrl: 'http://localhost:8000/v1' })).toBeNull();
    expect(matchPresetByBaseUrl({ baseUrl: 'https://api.groq.com/openai/v1' })).toBeNull();
  });
});

describe('findPresetForConnection', () => {
  it('maps a native connection to its provider preset', () => {
    expect(findPresetForConnection({ connection: { provider: AI_PROVIDER.anthropic } }).id).toBe('anthropic');
    expect(findPresetForConnection({ connection: { provider: AI_PROVIDER.google } }).id).toBe('google');
    expect(findPresetForConnection({ connection: { provider: AI_PROVIDER.openai } }).id).toBe('openai');
  });

  it('maps a custom connection to the quick-fill preset of its base URL', () => {
    expect(
      findPresetForConnection({ connection: { provider: AI_PROVIDER.custom, baseUrl: 'http://127.0.0.1:1234/v1' } }).id,
    ).toBe('lmStudio');
  });

  it('maps a subscription connection to its own preset', () => {
    expect(findPresetForConnection({ connection: { provider: AI_PROVIDER.claudeCode } }).id).toBe('claudeCode');
    expect(findPresetForConnection({ connection: { provider: AI_PROVIDER.codex } }).id).toBe('codex');
  });

  it('falls back to the generic custom preset', () => {
    expect(
      findPresetForConnection({
        connection: { provider: AI_PROVIDER.custom, baseUrl: 'https://api.groq.com/openai/v1' },
      }).id,
    ).toBe('custom');
    expect(findPresetForConnection({ connection: { provider: AI_PROVIDER.custom } }).id).toBe('custom');
  });
});

describe('subscription presets', () => {
  it('sign in through the vendor page instead of taking a key', () => {
    const subscriptionPresets = AI_CONNECTION_PRESETS.filter((preset) => isSubscriptionPreset({ preset }));

    expect(subscriptionPresets.map((preset) => preset.id)).toEqual(['claudeCode', 'codex']);
    for (const preset of subscriptionPresets) {
      expect(preset.keyRequired).toBe(false);
      expect(preset.baseUrl).toBeUndefined();
      expect(preset.signInLabelKey).toBeTruthy();
    }
  });

  it('are the only presets that do not take an API key', () => {
    const apiKeyPresets = AI_CONNECTION_PRESETS.filter((preset) => !isSubscriptionPreset({ preset }));

    expect(apiKeyPresets.every((preset) => preset.signInLabelKey === undefined)).toBe(true);
  });
});

describe('getVisiblePresets', () => {
  const API_KEY_PRESET_IDS = ['openai', 'anthropic', 'google', 'openrouter', 'ollama', 'lmStudio', 'custom'];

  const idsOf = ({ availability }: { availability: CliAiAvailability | null }) =>
    getVisiblePresets({ availability }).map((preset) => preset.id);

  const claudeInstalled = { provider: AI_PROVIDER.claudeCode, installed: true, version: '2.1.292' } as const;
  const codexInstalled = { provider: AI_PROVIDER.codex, installed: true, version: '0.160.1' } as const;
  const codexMissing = { provider: AI_PROVIDER.codex, installed: false, version: null } as const;

  it('hides the subscription presets on cloud, where no availability is requested', () => {
    expect(idsOf({ availability: null })).toEqual(API_KEY_PRESET_IDS);
  });

  it.each(['not-self-host', 'not-admin', 'admin-not-configured'] as const)(
    'hides the subscription presets when the backend answers %s',
    (reason) => {
      expect(idsOf({ availability: { available: false, reason, providers: [] } })).toEqual(API_KEY_PRESET_IDS);
    },
  );

  it('lists both subscription presets, enabled, for an admin on self-host', () => {
    const presets = getVisiblePresets({
      availability: { available: true, providers: [claudeInstalled, codexInstalled] },
    });

    expect(presets.map((preset) => preset.id)).toEqual([
      'openai',
      'anthropic',
      'google',
      'openrouter',
      'ollama',
      'lmStudio',
      'claudeCode',
      'codex',
      'custom',
    ]);
    expect(presets.every((preset) => !preset.disabled && preset.disabledReasonKey === undefined)).toBe(true);
  });

  it('keeps a preset listed but disabled, with a reason, when its CLI is missing from the image', () => {
    const presets = getVisiblePresets({
      availability: { available: true, providers: [claudeInstalled, codexMissing] },
    });

    expect(presets.find((preset) => preset.id === 'claudeCode')?.disabled).toBe(false);
    const codex = presets.find((preset) => preset.id === 'codex');
    expect(codex?.disabled).toBe(true);
    expect(codex?.disabledReasonKey).toBeTruthy();
  });

  it('disables a preset whose CLI the backend did not report at all', () => {
    const presets = getVisiblePresets({ availability: { available: true, providers: [claudeInstalled] } });

    expect(presets.find((preset) => preset.id === 'codex')?.disabled).toBe(true);
  });

  it('never disables the API key presets', () => {
    const presets = getVisiblePresets({ availability: { available: true, providers: [] } });

    expect(presets.filter((preset) => !isSubscriptionPreset({ preset })).every((preset) => !preset.disabled)).toBe(
      true,
    );
  });
});
