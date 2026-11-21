import type { McpToolsetSummary } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import ToolsetPicker from './toolset-picker.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false });

const TOOLSETS: McpToolsetSummary[] = [
  { id: 'core', scope: null, toolCount: 55 },
  { id: 'investments', scope: 'toolset:investments', toolCount: 29 },
  { id: 'ventures', scope: 'toolset:ventures', toolCount: 20 },
];

const mountPicker = ({ selected = new Set<string>() }: { selected?: Set<string> } = {}) =>
  mount(ToolsetPicker, {
    props: {
      toolsets: TOOLSETS,
      clientName: 'Claude',
      modelValue: selected,
      'onUpdate:modelValue': () => {},
    },
    global: { plugins: [i18n] },
  });

const lastEmitted = (wrapper: ReturnType<typeof mountPicker>) =>
  wrapper.emitted('update:modelValue')!.at(-1)![0] as Set<string>;

describe('ToolsetPicker', () => {
  it('shows core as a locked tile and one checkbox tile per optional toolset', () => {
    const wrapper = mountPicker();

    expect(wrapper.find('[data-testid="toolset-core"] button[role="checkbox"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="toolset-investments"] button[role="checkbox"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="toolset-ventures"] button[role="checkbox"]').exists()).toBe(true);
  });

  it('adds a toolset scope when its tile is ticked and drops it when unticked', async () => {
    const wrapper = mountPicker();

    await wrapper.get('[data-testid="toolset-investments"] button[role="checkbox"]').trigger('click');
    expect([...lastEmitted(wrapper)]).toEqual(['toolset:investments']);

    await wrapper.setProps({ modelValue: new Set(['toolset:investments']) });
    await wrapper.get('[data-testid="toolset-investments"] button[role="checkbox"]').trigger('click');
    expect([...lastEmitted(wrapper)]).toEqual([]);
  });

  it('selects every optional toolset with Add all and none with Core only', async () => {
    const wrapper = mountPicker({ selected: new Set(['toolset:ventures']) });

    await wrapper.get('[data-testid="toolsets-add-all"]').trigger('click');
    expect([...lastEmitted(wrapper)].toSorted()).toEqual(['toolset:investments', 'toolset:ventures']);

    await wrapper.get('[data-testid="toolsets-core-only"]').trigger('click');
    expect([...lastEmitted(wrapper)]).toEqual([]);
  });

  it('marks a selected tile', () => {
    const wrapper = mountPicker({ selected: new Set(['toolset:ventures']) });

    expect(wrapper.get('[data-testid="toolset-ventures"]').classes()).toContain('border-primary');
    expect(wrapper.get('[data-testid="toolset-investments"]').classes()).not.toContain('border-primary');
  });
});
