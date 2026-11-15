import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { createChatI18n } from './card-test-fixtures';
import TypedConfirmation from './typed-confirmation.vue';

const mountField = ({ modelValue = '', expected = '42' }: { modelValue?: string; expected?: string } = {}) =>
  mount(TypedConfirmation, { props: { modelValue, expected }, global: { plugins: [createChatI18n()] } });

describe('TypedConfirmation', () => {
  it('asks for the expected count', () => {
    const wrapper = mountField();

    expect(wrapper.text()).toContain('To approve, type 42');
    expect(wrapper.find('input').attributes('placeholder')).toBe('Type the number');
  });

  it('emits what the user types', async () => {
    const wrapper = mountField();

    await wrapper.find('input').setValue('41');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['41']);
  });

  it('shows a mismatch only once something was typed and it differs', () => {
    expect(mountField({ modelValue: '' }).text()).not.toContain('does not match');
    expect(mountField({ modelValue: '41' }).text()).toContain('The number does not match.');
    expect(mountField({ modelValue: '42' }).text()).not.toContain('does not match');
  });
});
