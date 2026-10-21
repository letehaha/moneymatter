import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { useAiConnectionModels } from '@/composable/data-queries/use-ai-connection-models';
import { useAiConnectionsList } from '@/composable/data-queries/use-ai-connections';
import enCommon from '@/i18n/locales/chunks/en/common.json';
import enChat from '@/i18n/locales/chunks/en/pages/chat.json';
import { AI_PROVIDER, type AIConnectionInfo } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { createI18n } from 'vue-i18n';

import ChatConnectionPicker from './chat-connection-picker.vue';

vi.mock('@/composable/data-queries/use-ai-connections', () => ({ useAiConnectionsList: vi.fn() }));
vi.mock('@/composable/data-queries/use-ai-connection-models', () => ({ useAiConnectionModels: vi.fn() }));
vi.mock('@/composable/data-queries/ai-settings', () => ({ useAiSettings: vi.fn() }));

const connection = (overrides: Partial<AIConnectionInfo> = {}): AIConnectionInfo => ({
  id: 'c1',
  provider: AI_PROVIDER.custom,
  name: 'Home Ollama',
  model: 'llama3.2',
  hasApiKey: false,
  createdAt: '2026-03-05T10:00:00.000Z',
  status: 'valid',
  lastValidatedAt: '2026-03-05T10:00:00.000Z',
  ...overrides,
});

const state = {
  connections: ref<AIConnectionInfo[]>([]),
  includedModelName: ref<string | null>(null),
  liveModels: ref<string[]>([]),
};

/** The select reports the option the user picked; the real one renders its options in a portal. */
const SelectStub = defineComponent({
  props: ['modelValue', 'values', 'disabled', 'labelKey'],
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h(
        'div',
        {
          'data-testid': 'select',
          'data-selected': props.modelValue ? props.labelKey(props.modelValue) : '',
          'data-disabled': String(props.disabled),
        },
        props.values.map((option: { value: string }) =>
          h(
            'button',
            { 'data-testid': `option-${option.value}`, onClick: () => emit('update:modelValue', option) },
            props.labelKey(option),
          ),
        ),
      ),
});

const mountPicker = (props: { connectionId: string | null; modelId?: string | null; disabled?: boolean }) =>
  mount(ChatConnectionPicker, {
    props,
    global: {
      plugins: [
        createI18n({ legacy: false, locale: 'en', messages: { en: { ...enChat, ...enCommon } }, missingWarn: false }),
      ],
      stubs: { SelectField: SelectStub },
    },
  });

describe('ChatConnectionPicker', () => {
  beforeEach(() => {
    state.connections.value = [
      connection({ id: 'c1', name: 'Home Ollama', model: 'llama3.2' }),
      connection({ id: 'c2', name: 'Studio vLLM', model: 'qwen2.5' }),
    ];
    state.includedModelName.value = null;
    state.liveModels.value = ['llama3.2', 'llama3.2:70b'];
    vi.mocked(useAiConnectionModels).mockReturnValue({
      liveModels: computed(() => state.liveModels.value),
      isLoadingLiveModels: ref(false),
    } as unknown as ReturnType<typeof useAiConnectionModels>);
    vi.mocked(useAiConnectionsList).mockReturnValue({
      connections: computed(() => state.connections.value),
    } as unknown as ReturnType<typeof useAiConnectionsList>);
    vi.mocked(useAiSettings).mockReturnValue({
      getFeatureStatus: () => ({ serverModelName: state.includedModelName.value }),
    } as unknown as ReturnType<typeof useAiSettings>);
  });

  it('lists every connection with its model and shows the thread connection as selected', () => {
    state.liveModels.value = [];
    const wrapper = mountPicker({ connectionId: 'c2' });

    expect(wrapper.find('[data-testid="option-c1"]').text()).toBe('Home Ollama (llama3.2)');
    expect(wrapper.find('[data-testid="option-c2"]').text()).toBe('Studio vLLM (qwen2.5)');
    expect(wrapper.find('[data-testid="select"]').attributes('data-selected')).toBe('Studio vLLM (qwen2.5)');
  });

  it('offers the included model only where one serves chat', async () => {
    const wrapper = mountPicker({ connectionId: 'c1' });
    expect(wrapper.find('[data-testid="option-included"]').exists()).toBe(false);

    state.includedModelName.value = 'Gemini';
    const withIncluded = mountPicker({ connectionId: null });

    expect(withIncluded.find('[data-testid="option-included"]').text()).toBe('Included model');
    expect(withIncluded.find('[data-testid="select"]').attributes('data-selected')).toBe('Included model');
  });

  it('reports the picked connection, and null for the included model', async () => {
    state.includedModelName.value = 'Gemini';
    const wrapper = mountPicker({ connectionId: 'c1' });

    await wrapper.find('[data-testid="option-c2"]').trigger('click');
    await wrapper.find('[data-testid="option-included"]').trigger('click');

    expect(wrapper.emitted('select')).toEqual([['c2'], [null]]);
  });

  describe('model within the connection', () => {
    const modelSelect = (wrapper: ReturnType<typeof mountPicker>) => wrapper.findAll('[data-testid="select"]')[1];

    it('offers the connection default and the other models of its provider next to the connection', () => {
      const wrapper = mountPicker({ connectionId: 'c1' });

      expect(wrapper.findAll('[data-testid="select"]')).toHaveLength(2);
      expect(modelSelect(wrapper)!.text()).toContain('Default (llama3.2)');
      expect(modelSelect(wrapper)!.text()).toContain('llama3.2:70b');
      expect(modelSelect(wrapper)!.attributes('data-selected')).toBe('Default (llama3.2)');
    });

    it('shows the model the thread was set to as selected', () => {
      const wrapper = mountPicker({ connectionId: 'c1', modelId: 'llama3.2:70b' });

      expect(modelSelect(wrapper)!.attributes('data-selected')).toBe('llama3.2:70b');
    });

    it('reports the picked model, and null for the connection default', async () => {
      const wrapper = mountPicker({ connectionId: 'c1', modelId: 'llama3.2:70b' });

      await wrapper.find('[data-testid="option-llama3.2:70b"]').trigger('click');
      await modelSelect(wrapper)!.findAll('button')[0]!.trigger('click');

      // Picking what is already selected reports nothing.
      expect(wrapper.emitted('select-model')).toEqual([[null]]);
    });

    it('is left out for the included model, which has no choice of model', () => {
      state.includedModelName.value = 'Gemini';

      expect(mountPicker({ connectionId: null }).findAll('[data-testid="select"]')).toHaveLength(1);
    });

    it('names the connection alone, since the model select beside it names the model', async () => {
      const wrapper = mountPicker({ connectionId: 'c2' });
      await nextTick();

      expect(wrapper.find('[data-testid="option-c1"]').text()).toBe('Home Ollama');
      expect(wrapper.find('[data-testid="option-c2"]').text()).toBe('Studio vLLM');
      expect(wrapper.find('[data-testid="select"]').attributes('data-selected')).toBe('Studio vLLM');
    });

    it('keeps naming the model next to the connection when the provider offers no other model', () => {
      state.liveModels.value = [];

      const wrapper = mountPicker({ connectionId: 'c2' });

      expect(wrapper.findAll('[data-testid="select"]')).toHaveLength(1);
      expect(wrapper.find('[data-testid="select"]').attributes('data-selected')).toBe('Studio vLLM (qwen2.5)');
    });

    it('still flags a connection that needs attention when only its name is shown', async () => {
      state.connections.value = [connection({ id: 'c1', status: 'invalid' })];

      const wrapper = mountPicker({ connectionId: 'c1' });
      await nextTick();

      expect(wrapper.find('[data-testid="option-c1"]').text()).toBe('Home Ollama - needs attention');
    });

    it('follows the disabled state of the picker', () => {
      const wrapper = mountPicker({ connectionId: 'c1', disabled: true });

      expect(modelSelect(wrapper)!.attributes('data-disabled')).toBe('true');
    });
  });

  it('is disabled while told to', () => {
    expect(
      mountPicker({ connectionId: 'c1', disabled: true }).find('[data-testid="select"]').attributes('data-disabled'),
    ).toBe('true');
    expect(mountPicker({ connectionId: 'c1' }).find('[data-testid="select"]').attributes('data-disabled')).toBe(
      'false',
    );
  });

  it('names a connection that needs attention', () => {
    state.liveModels.value = [];
    state.connections.value = [connection({ id: 'c1', status: 'invalid' })];

    const wrapper = mountPicker({ connectionId: 'c1' });

    expect(wrapper.find('[data-testid="option-c1"]').text()).toBe('Home Ollama (llama3.2) - needs attention');
  });

  it('selects nothing for a connection that was deleted', () => {
    const wrapper = mountPicker({ connectionId: 'deleted' });

    expect(wrapper.find('[data-testid="select"]').attributes('data-selected')).toBe('');
  });

  it('renders nothing while there is nothing to pick', () => {
    state.connections.value = [];

    const wrapper = mountPicker({ connectionId: null });

    expect(wrapper.find('[data-testid="chat-connection-picker"]').exists()).toBe(false);
  });
});
