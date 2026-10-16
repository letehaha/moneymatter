import {
  AIConnectionInfo,
  AI_PROVIDER,
  CLI_AI_MODELS,
  type CliAiAvailability,
  asAiCliProvider,
} from '@bt/shared/types';

export type AiConnectionPresetId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'ollama'
  | 'lmStudio'
  | 'claudeCode'
  | 'codex'
  | 'custom';

export interface AiConnectionPreset {
  id: AiConnectionPresetId;
  provider: AI_PROVIDER;
  labelKey: string;
  namePlaceholderKey: string;
  /** Prefilled into the editable base URL field; only `custom` presets have one. */
  baseUrl?: string;
  keyUrl?: string;
  keyRequired: boolean;
  /** Runs on the user's machine, which only a self-hosted backend can reach. */
  isLocal?: boolean;
  /** `subscription` signs in through the vendor's login page instead of taking an API key. Absent means API key. */
  authKind?: 'subscription';
  /** Label of the button that starts a subscription sign-in. */
  signInLabelKey?: string;
}

/** A preset as the provider picker offers it. */
export interface AiConnectionPresetOption extends AiConnectionPreset {
  disabled: boolean;
  /** Why a disabled preset can't be picked. */
  disabledReasonKey?: string;
}

export const AI_CONNECTION_PRESETS: AiConnectionPreset[] = [
  {
    id: 'openai',
    provider: AI_PROVIDER.openai,
    labelKey: 'settings.ai.connections.presets.openai.label',
    namePlaceholderKey: 'settings.ai.connections.presets.openai.namePlaceholder',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyRequired: true,
  },
  {
    id: 'anthropic',
    provider: AI_PROVIDER.anthropic,
    labelKey: 'settings.ai.connections.presets.anthropic.label',
    namePlaceholderKey: 'settings.ai.connections.presets.anthropic.namePlaceholder',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyRequired: true,
  },
  {
    id: 'google',
    provider: AI_PROVIDER.google,
    labelKey: 'settings.ai.connections.presets.google.label',
    namePlaceholderKey: 'settings.ai.connections.presets.google.namePlaceholder',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyRequired: true,
  },
  {
    id: 'openrouter',
    provider: AI_PROVIDER.custom,
    labelKey: 'settings.ai.connections.presets.openrouter.label',
    namePlaceholderKey: 'settings.ai.connections.presets.openrouter.namePlaceholder',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    keyRequired: true,
  },
  {
    id: 'ollama',
    provider: AI_PROVIDER.custom,
    labelKey: 'settings.ai.connections.presets.ollama.label',
    namePlaceholderKey: 'settings.ai.connections.presets.ollama.namePlaceholder',
    baseUrl: 'http://localhost:11434/v1',
    keyRequired: false,
    isLocal: true,
  },
  {
    id: 'lmStudio',
    provider: AI_PROVIDER.custom,
    labelKey: 'settings.ai.connections.presets.lmStudio.label',
    namePlaceholderKey: 'settings.ai.connections.presets.lmStudio.namePlaceholder',
    baseUrl: 'http://localhost:1234/v1',
    keyRequired: false,
    isLocal: true,
  },
  {
    id: 'claudeCode',
    provider: AI_PROVIDER.claudeCode,
    labelKey: 'settings.ai.connections.presets.claudeCode.label',
    namePlaceholderKey: 'settings.ai.connections.presets.claudeCode.namePlaceholder',
    keyRequired: false,
    authKind: 'subscription',
    signInLabelKey: 'settings.ai.connections.presets.claudeCode.signInLabel',
  },
  {
    id: 'codex',
    provider: AI_PROVIDER.codex,
    labelKey: 'settings.ai.connections.presets.codex.label',
    namePlaceholderKey: 'settings.ai.connections.presets.codex.namePlaceholder',
    keyRequired: false,
    authKind: 'subscription',
    signInLabelKey: 'settings.ai.connections.presets.codex.signInLabel',
  },
  {
    id: 'custom',
    provider: AI_PROVIDER.custom,
    labelKey: 'settings.ai.connections.presets.custom.label',
    namePlaceholderKey: 'settings.ai.connections.presets.custom.namePlaceholder',
    keyRequired: false,
  },
];

const CUSTOM_PRESET = AI_CONNECTION_PRESETS.find((preset) => preset.id === 'custom')!;

const normalizeBaseUrl = ({ baseUrl }: { baseUrl: string }) =>
  baseUrl.trim().toLowerCase().replace(/\/+$/, '').replace('://127.0.0.1', '://localhost');

/** The quick-fill preset a custom base URL came from; loopback spellings count as the same host. */
export const matchPresetByBaseUrl = ({ baseUrl }: { baseUrl: string }): AiConnectionPreset | null => {
  const normalized = normalizeBaseUrl({ baseUrl });
  return (
    AI_CONNECTION_PRESETS.find(
      (preset) => preset.baseUrl !== undefined && normalizeBaseUrl({ baseUrl: preset.baseUrl }) === normalized,
    ) ?? null
  );
};

export const findPresetForConnection = ({
  connection,
}: {
  connection: Pick<AIConnectionInfo, 'provider' | 'baseUrl'>;
}): AiConnectionPreset => {
  if (connection.provider !== AI_PROVIDER.custom) {
    return AI_CONNECTION_PRESETS.find((preset) => preset.provider === connection.provider) ?? CUSTOM_PRESET;
  }
  return (connection.baseUrl && matchPresetByBaseUrl({ baseUrl: connection.baseUrl })) || CUSTOM_PRESET;
};

export const isSubscriptionPreset = ({ preset }: { preset: AiConnectionPreset }): boolean =>
  preset.authKind === 'subscription';

/** The model a new subscription connection starts with; empty for a preset that has no curated list. */
export const getDefaultCliModel = ({ preset }: { preset: AiConnectionPreset }): string => {
  const cliProvider = asAiCliProvider({ provider: preset.provider });
  if (!cliProvider) return '';
  return CLI_AI_MODELS[cliProvider].find((model) => model.isDefault)?.id ?? '';
};

const CLI_NOT_INSTALLED_REASON_KEY = 'settings.ai.connections.presets.cliNotInstalled';

/**
 * The presets the provider picker lists. Subscription presets appear only once the backend reports the
 * feature available (self-hosted instance, signed in as an admin); an unanswered or unavailable
 * availability hides them, whatever the reason. When available, one whose CLI is missing from the
 * backend image stays listed but disabled.
 */
export const getVisiblePresets = ({
  availability,
}: {
  availability: CliAiAvailability | null | undefined;
}): AiConnectionPresetOption[] =>
  AI_CONNECTION_PRESETS.flatMap((preset): AiConnectionPresetOption[] => {
    if (!isSubscriptionPreset({ preset })) return [{ ...preset, disabled: false }];
    if (!availability?.available) return [];

    const cliProvider = asAiCliProvider({ provider: preset.provider });
    const isInstalled = availability.providers.some((entry) => entry.provider === cliProvider && entry.installed);

    return [
      {
        ...preset,
        disabled: !isInstalled,
        disabledReasonKey: isInstalled ? undefined : CLI_NOT_INSTALLED_REASON_KEY,
      },
    ];
  });
