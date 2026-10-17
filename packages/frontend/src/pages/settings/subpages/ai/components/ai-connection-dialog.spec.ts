import { AI_PROVIDER, type AIConnectionInfo } from '@bt/shared/types';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('@/js/errors', () => ({ extractApiErrorMessage: () => undefined }));
vi.mock('@/lib/auth-client', () => ({ authClient: {} }));
vi.mock('@/common/config', () => ({ config: { isSelfHost: true } }));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addSuccessNotification: vi.fn(), addWarningNotification: vi.fn() }),
}));
vi.mock('@/composable/data-queries/use-ai-connections', () => ({
  useAiConnections: () => ({
    createConnection: vi.fn(),
    isCreatingConnection: ref(false),
    updateConnection: vi.fn(),
    isUpdatingConnection: ref(false),
    testConnection: vi.fn(),
    isTestingConnection: ref(false),
  }),
}));
vi.mock('@/composable/data-queries/use-ai-connection-models', () => ({
  useAiConnectionModels: () => ({ liveModels: ref([]), isLoadingLiveModels: ref(false) }),
}));
vi.mock('@/composable/data-queries/use-cli-ai-availability', () => ({
  useCliAiAvailability: () => ({
    availability: ref({
      available: true,
      providers: [
        { provider: 'claude-code', installed: true, version: '1.0.0' },
        { provider: 'codex', installed: true, version: '1.0.0' },
      ],
    }),
  }),
}));

import AiConnectionDialog from './ai-connection-dialog.vue';

/** Stands in for the reka-ui select, which renders its options only once opened. */
const SelectFieldStub = defineComponent({
  name: 'SelectField',
  props: {
    modelValue: { type: Object, default: null },
    values: { type: Array, default: () => [] },
    labelKey: { type: [String, Function], default: 'label' },
    valueKey: { type: [String, Function], default: 'value' },
    label: { type: String, default: '' },
  },
  setup(props) {
    return () =>
      h('div', { 'data-field': props.label }, [
        h(
          'span',
          { 'data-selected': '' },
          props.modelValue ? String((props.modelValue as Record<string, unknown>).id) : '',
        ),
        ...(props.values as Record<string, unknown>[]).map((value) =>
          h('i', { 'data-option': String(value.id) }, String(value.label ?? '')),
        ),
      ]);
  },
});

const makeConnection = (overrides: Partial<AIConnectionInfo> = {}): AIConnectionInfo => ({
  id: 'connection-1',
  provider: AI_PROVIDER.claudeCode,
  name: 'Claude Code',
  model: 'sonnet',
  hasApiKey: true,
  createdAt: '2026-10-17T10:00:00.000Z',
  status: 'valid',
  lastValidatedAt: '2026-10-17T10:00:00.000Z',
  ...overrides,
});

const mountDialog = async ({ connection }: { connection: AIConnectionInfo }) => {
  const wrapper = mount(AiConnectionDialog, {
    props: { open: true, connection },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        ResponsiveDialog: { template: '<div><slot /></div>' },
        ResponsiveAlertDialog: true,
        CliSignInPanel: true,
        Callout: true,
        InputField: true,
        AutocompleteField: { template: '<div data-autocomplete />' },
        SelectField: SelectFieldStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
};

const modelField = (wrapper: Awaited<ReturnType<typeof mountDialog>>) =>
  wrapper.find('[data-field="settings.ai.connections.form.modelLabel"]');

describe('AiConnectionDialog model field for a subscription preset', () => {
  it('renders a select with exactly the four Claude models, not a combobox', async () => {
    const wrapper = await mountDialog({ connection: makeConnection() });
    const field = modelField(wrapper);

    expect(wrapper.find('[data-autocomplete]').exists()).toBe(false);
    expect(field.findAll('[data-option]').map((option) => option.attributes('data-option'))).toEqual([
      'sonnet',
      'opus',
      'haiku',
      'fable',
    ]);
    expect(field.findAll('[data-option]').map((option) => option.text())).toEqual([
      'Claude Sonnet 5.5',
      'Claude Opus 5.5',
      'Claude Haiku 5.5',
      'Claude Fable 5.1',
    ]);
  });

  it('shows a legacy pinned id as its alias option', async () => {
    const wrapper = await mountDialog({ connection: makeConnection({ model: 'claude-opus-5-5' }) });
    const field = modelField(wrapper);

    expect(field.find('[data-selected]').text()).toBe('opus');
    expect(field.findAll('[data-option]')).toHaveLength(4);
  });

  it('lists the Codex models and selects the stored one', async () => {
    const wrapper = await mountDialog({
      connection: makeConnection({ provider: AI_PROVIDER.codex, name: 'Codex', model: 'gpt-5.3-codex' }),
    });
    const field = modelField(wrapper);

    expect(field.find('[data-selected]').text()).toBe('gpt-5.3-codex');
    expect(field.findAll('[data-option]').map((option) => option.text())).toContain('GPT-5.3 Codex');
  });
});

describe('AiConnectionDialog model field for another provider', () => {
  it('keeps the free-text combobox', async () => {
    const wrapper = await mountDialog({
      connection: makeConnection({ provider: AI_PROVIDER.openai, name: 'OpenAI', model: 'gpt-5.5' }),
    });

    expect(wrapper.find('[data-autocomplete]').exists()).toBe(true);
    expect(modelField(wrapper).exists()).toBe(false);
  });
});
