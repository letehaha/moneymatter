import { useAiConnectionModels } from '@/composable/data-queries/use-ai-connection-models';
import enCommon from '@/i18n/locales/chunks/en/common.json';
import { AI_PROVIDER } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { createI18n } from 'vue-i18n';

import ConnectionModelSelect from './connection-model-select.vue';

vi.mock('@/composable/data-queries/use-ai-connection-models', () => ({ useAiConnectionModels: vi.fn() }));

const state = { liveModels: ref<string[]>([]), isLoading: ref(false) };

/** Reports the option the user picked; the real select renders its options in a portal. */
const SelectStub = defineComponent({
  props: ['modelValue', 'values', 'labelKey', 'disabled'],
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h(
        'div',
        { 'data-testid': 'select', 'data-selected': props.modelValue ? props.labelKey(props.modelValue) : '' },
        props.values.map((option: { value: string }) =>
          h(
            'button',
            { 'data-testid': `option-${option.value}`, onClick: () => emit('update:modelValue', option) },
            props.labelKey(option),
          ),
        ),
      ),
});

const CONNECTION = { id: 'c1', provider: AI_PROVIDER.anthropic, model: 'claude-haiku-5-5' } as const;

const mountSelect = (props: { modelId: string | null }) =>
  mount(ConnectionModelSelect, {
    props: { connection: CONNECTION, ...props },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enCommon }, missingWarn: false })],
      stubs: { SelectField: SelectStub },
    },
  });

describe('ConnectionModelSelect', () => {
  beforeEach(() => {
    state.liveModels.value = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
    state.isLoading.value = false;
    vi.mocked(useAiConnectionModels).mockReturnValue({
      liveModels: computed(() => state.liveModels.value),
      isLoadingLiveModels: state.isLoading,
    } as unknown as ReturnType<typeof useAiConnectionModels>);
  });

  it('lists the models of the connection provider by its stored connection, with the default first', () => {
    const wrapper = mountSelect({ modelId: null });

    expect(vi.mocked(useAiConnectionModels).mock.calls[0]![0].params).toBeTypeOf('function');
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Default (claude-haiku-5-5)',
      'claude-sonnet-5-5',
    ]);
    expect(wrapper.find('[data-testid="select"]').attributes('data-selected')).toBe('Default (claude-haiku-5-5)');
  });

  it('reports the picked model, and null for the default', async () => {
    const wrapper = mountSelect({ modelId: 'claude-sonnet-5-5' });

    await wrapper.find('[data-testid="option-__connection-default__"]').trigger('click');

    expect(wrapper.emitted('select')).toEqual([[null]]);
  });

  it('reports nothing for the model that is already selected', async () => {
    const wrapper = mountSelect({ modelId: 'claude-sonnet-5-5' });

    await wrapper.find('[data-testid="option-claude-sonnet-5-5"]').trigger('click');

    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('tells its parent when it offers a choice, so the connection can be named alone', async () => {
    const wrapper = mountSelect({ modelId: null });
    expect(wrapper.emitted('update:hasChoice')?.at(-1)).toEqual([true]);

    state.liveModels.value = [];
    await nextTick();

    expect(wrapper.emitted('update:hasChoice')?.at(-1)).toEqual([false]);
  });

  it('renders nothing when the provider offers no model but the default', () => {
    state.liveModels.value = [];

    expect(mountSelect({ modelId: null }).find('[data-testid="select"]').exists()).toBe(false);
  });

  it('stays while the list loads, so the control does not pop in', () => {
    state.liveModels.value = [];
    state.isLoading.value = true;

    expect(mountSelect({ modelId: null }).find('[data-testid="select"]').exists()).toBe(true);
  });
});
