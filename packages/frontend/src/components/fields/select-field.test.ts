import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import SelectField from './select-field.vue';

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } });

const item = { value: 1, label: 'Payee' };

const mountField = (props: Record<string, unknown> = {}) =>
  mount(SelectField, {
    props: { modelValue: item, values: [item], clearable: true, ...props },
    global: { plugins: [i18n] },
  });

const findClear = (wrapper: ReturnType<typeof mountField>) => wrapper.find('button[aria-label*="clearSelection"]');

describe('SelectField clear button', () => {
  it('emits null on click and sits outside the trigger, which would otherwise swallow the click', async () => {
    const wrapper = mountField();
    const clear = findClear(wrapper);

    expect(clear.element.closest('[role="combobox"]')).toBeNull();

    await clear.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });

  it.each([{ clearable: false }, { modelValue: null }])('is hidden for %o', (props) => {
    expect(findClear(mountField(props)).exists()).toBe(false);
  });

  it('stays in place but is disabled while the field is disabled', () => {
    expect(findClear(mountField({ disabled: true })).attributes('disabled')).toBeDefined();
  });
});
