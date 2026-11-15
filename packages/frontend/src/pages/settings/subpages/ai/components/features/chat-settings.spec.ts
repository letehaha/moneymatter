import { useUpdateChatSettings } from '@/composable/data-queries/chat';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import enAi from '@/i18n/locales/chunks/en/settings/ai.json';
import { ROUTES_NAMES } from '@/routes/constants';
import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { createI18n } from 'vue-i18n';

import ChatSettings from './chat-settings.vue';

vi.mock('@/composable/data-queries/chat', () => ({ useUpdateChatSettings: vi.fn() }));
vi.mock('@/composable/data-queries/user-settings', () => ({ useUserSettings: vi.fn() }));

const mutateAsync = vi.fn();
const isPending = ref(false);
const settingsData = ref<{ ai?: { chat?: { retentionDays?: number | null } } } | undefined>({});

/** The select reports the option the user picked; the real one renders its options in a portal. */
const SelectStub = defineComponent({
  props: ['modelValue', 'values', 'disabled'],
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h(
        'div',
        {
          'data-testid': 'retention-select',
          'data-selected': props.modelValue?.label,
          'data-disabled': String(props.disabled),
        },
        [
          ...props.values.map((option: { value: string; label: string }) =>
            h(
              'button',
              { 'data-testid': `option-${option.value}`, onClick: () => emit('update:modelValue', option) },
              option.label,
            ),
          ),
        ],
      ),
});

const mountSettings = () =>
  mount(ChatSettings, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enAi }, missingWarn: false })],
      stubs: { SelectField: SelectStub, RouterLink: RouterLinkStub },
    },
  });

describe('ChatSettings', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({});
    isPending.value = false;
    settingsData.value = {};
    vi.mocked(useUpdateChatSettings).mockReturnValue({ mutateAsync, isPending } as unknown as ReturnType<
      typeof useUpdateChatSettings
    >);
    vi.mocked(useUserSettings).mockReturnValue({ data: computed(() => settingsData.value) } as unknown as ReturnType<
      typeof useUserSettings
    >);
  });

  it('offers 7, 30, 90 and 365 days and never', () => {
    const wrapper = mountSettings();

    expect(wrapper.findAll('[data-testid^="option-"]').map((option) => option.text())).toEqual([
      '7 days',
      '30 days',
      '90 days',
      '1 year',
      'Never delete automatically',
    ]);
  });

  it('shows 30 days for someone who never chose', () => {
    expect(mountSettings().find('[data-testid="retention-select"]').attributes('data-selected')).toBe('30 days');
  });

  it('shows the stored choice, "never" included', () => {
    settingsData.value = { ai: { chat: { retentionDays: 90 } } };
    expect(mountSettings().find('[data-testid="retention-select"]').attributes('data-selected')).toBe('90 days');

    settingsData.value = { ai: { chat: { retentionDays: null } } };
    expect(mountSettings().find('[data-testid="retention-select"]').attributes('data-selected')).toBe(
      'Never delete automatically',
    );
  });

  it('writes the choice through the chat settings endpoint', async () => {
    const wrapper = mountSettings();

    await wrapper.find('[data-testid="option-90"]').trigger('click');
    await flushPromises();

    expect(mutateAsync).toHaveBeenCalledWith({ retentionDays: 90 });
  });

  it('writes "never" as null', async () => {
    const wrapper = mountSettings();

    await wrapper.find('[data-testid="option-never"]').trigger('click');
    await flushPromises();

    expect(mutateAsync).toHaveBeenCalledWith({ retentionDays: null });
  });

  it('does not write the choice that is already stored', async () => {
    const wrapper = mountSettings();

    await wrapper.find('[data-testid="option-30"]').trigger('click');

    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('locks the select while a change is being saved', () => {
    isPending.value = true;

    expect(mountSettings().find('[data-testid="retention-select"]').attributes('data-disabled')).toBe('true');
  });

  it('says pinned conversations are kept and unapproved cards expire', () => {
    const text = mountSettings().text();

    expect(text).toContain('Pinned conversations are never deleted automatically.');
    expect(text).toContain('expire after 24 hours');
  });

  it('links to the applied changes', () => {
    const link = mountSettings().findComponent(RouterLinkStub);

    expect(link.props('to')).toEqual({ name: ROUTES_NAMES.settingsAiChatApplied });
  });
});
