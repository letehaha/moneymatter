import { mount } from '@vue/test-utils';
import { h } from 'vue';

import InputField from './input-field.vue';

describe('InputField component', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mountComponent = (props: Record<string, any> = {}, slots: Record<string, any> = {}) =>
    mount(InputField, { props, slots } as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  describe('basic rendering', () => {
    it('renders input element', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('input').exists()).toBe(true);
    });

    it('renders with label', () => {
      const wrapper = mountComponent({ label: 'Test Label' });
      expect(wrapper.text()).toContain('Test Label');
    });

    it('renders placeholder', () => {
      const wrapper = mountComponent({ placeholder: 'Enter value' });
      expect(wrapper.find('input').attributes('placeholder')).toBe('Enter value');
    });

    it('applies error class when errorMessage is provided', () => {
      const wrapper = mountComponent({ errorMessage: 'Error' });
      expect(wrapper.find('.input-field--error').exists()).toBe(true);
    });

    it('displays error message', () => {
      const wrapper = mountComponent({ errorMessage: 'This field is required' });
      expect(wrapper.text()).toContain('This field is required');
    });

    it('applies disabled class when disabled', () => {
      const wrapper = mountComponent({ disabled: true });
      expect(wrapper.find('.input-field--disabled').exists()).toBe(true);
      expect(wrapper.find('input').attributes('disabled')).toBeDefined();
    });
  });

  describe('text input behavior', () => {
    it('displays modelValue for text input', () => {
      const wrapper = mountComponent({ modelValue: 'test value', type: 'text' });
      expect(wrapper.find('input').element.value).toBe('test value');
    });

    it('emits update:modelValue on text input', async () => {
      const wrapper = mountComponent({ type: 'text' });
      const input = wrapper.find('input');

      await input.setValue('new value');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')![0]).toEqual(['new value']);
    });

    it('displays empty string when modelValue is null', () => {
      const wrapper = mountComponent({ modelValue: null, type: 'text' });
      expect(wrapper.find('input').element.value).toBe('');
    });
  });

  describe('number input behavior', () => {
    it('displays modelValue for number input', () => {
      const wrapper = mountComponent({ modelValue: 123, type: 'number' });
      expect(wrapper.find('input').element.value).toBe('123');
    });

    it('emits numeric value on number input', async () => {
      const wrapper = mountComponent({ type: 'number' });
      const input = wrapper.find('input');

      await input.setValue('456');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([456]);
    });

    it('emits null for empty number input', async () => {
      const wrapper = mountComponent({ modelValue: 123, type: 'number' });
      const input = wrapper.find('input');

      await input.setValue('');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([null]);
    });

    it('sets step="any" for number inputs', () => {
      const wrapper = mountComponent({ type: 'number' });
      expect(wrapper.find('input').attributes('step')).toBe('any');
    });

    it('does not set step for non-number inputs', () => {
      const wrapper = mountComponent({ type: 'text' });
      expect(wrapper.find('input').attributes('step')).toBeUndefined();
    });
  });

  describe('intermediate decimal preservation', () => {
    // Helper to simulate typing in a number input by triggering the input event
    // This bypasses browser validation that would reject values like "1234."
    const simulateNumberInput = async (wrapper: ReturnType<typeof mountComponent>, value: string) => {
      const input = wrapper.find('input');
      const inputEl = input.element as HTMLInputElement;

      // Create and dispatch input event with the raw string value
      const event = new Event('input', { bubbles: true });
      Object.defineProperty(event, 'target', {
        value: { value },
        writable: false,
      });

      // Directly set the internal value for the event handler to read
      inputEl.value = value;
      inputEl.dispatchEvent(event);

      await wrapper.vm.$nextTick();
    };

    it('does not emit when trailing decimal does not change numeric value', async () => {
      const wrapper = mountComponent({ modelValue: 1234, type: 'number' });

      await simulateNumberInput(wrapper, '1234.');

      // Number('1234.') = 1234, same as modelValue, so no emit should happen
      // This is correct - the component only emits when the numeric value changes
      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });

    it('does not emit when trailing zero does not change numeric value', async () => {
      const wrapper = mountComponent({ modelValue: 1234, type: 'number' });

      await simulateNumberInput(wrapper, '1234.0');

      // Number('1234.0') = 1234, same as modelValue, so no emit should happen
      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });

    it('emits when starting from null and typing intermediate decimal', async () => {
      const wrapper = mountComponent({ modelValue: null, type: 'number' });

      await simulateNumberInput(wrapper, '1234.0');

      // Number('1234.0') = 1234, different from null, so emit should happen
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([1234]);
    });

    it('emits correct numeric value for complete decimals', async () => {
      const wrapper = mountComponent({ type: 'number' });

      await simulateNumberInput(wrapper, '1234.03');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([1234.03]);
    });

    it('emits correct value after typing sequence 1234.0 -> 1234.03', async () => {
      const wrapper = mountComponent({ type: 'number' });

      // First type "1234.0"
      await simulateNumberInput(wrapper, '1234.0');
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([1234]);

      // Then complete to "1234.03"
      await simulateNumberInput(wrapper, '1234.03');
      expect(wrapper.emitted('update:modelValue')![1]).toEqual([1234.03]);
    });

    it('handles decimal values with trailing zeros like 1234.10', async () => {
      const wrapper = mountComponent({ type: 'number' });

      await simulateNumberInput(wrapper, '1234.10');

      // Number('1234.10') = 1234.1
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([1234.1]);
    });
  });

  describe('onlyPositive prop', () => {
    it('sets min to 0 when onlyPositive is true', () => {
      const wrapper = mountComponent({ onlyPositive: true, type: 'number' });
      expect(wrapper.find('input').attributes('min')).toBe('0');
    });

    it('prevents minus key when onlyPositive is true', async () => {
      const wrapper = mountComponent({ onlyPositive: true, type: 'number' });
      const input = wrapper.find('input');

      const event = new KeyboardEvent('keypress', { key: '-' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      input.element.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('prevents plus key when onlyPositive is true', async () => {
      const wrapper = mountComponent({ onlyPositive: true, type: 'number' });
      const input = wrapper.find('input');

      const event = new KeyboardEvent('keypress', { key: '+' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      input.element.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('prevents equal key when onlyPositive is true', async () => {
      const wrapper = mountComponent({ onlyPositive: true, type: 'number' });
      const input = wrapper.find('input');

      const event = new KeyboardEvent('keypress', { key: '=' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      input.element.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('allows number keys when onlyPositive is true', async () => {
      const wrapper = mountComponent({ onlyPositive: true, type: 'number' });
      const input = wrapper.find('input');

      const event = new KeyboardEvent('keypress', { key: '5' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      input.element.dispatchEvent(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('scientific notation prevention', () => {
    it('prevents lowercase "e" key in number input', async () => {
      const wrapper = mountComponent({ type: 'number' });
      const input = wrapper.find('input');

      const event = new KeyboardEvent('keypress', { key: 'e' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      input.element.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('prevents uppercase "E" key in number input', async () => {
      const wrapper = mountComponent({ type: 'number' });
      const input = wrapper.find('input');

      const event = new KeyboardEvent('keypress', { key: 'E' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      input.element.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('allows "e" key in text input', async () => {
      const wrapper = mountComponent({ type: 'text' });
      const input = wrapper.find('input');

      const event = new KeyboardEvent('keypress', { key: 'e' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      input.element.dispatchEvent(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('disabled state', () => {
    it('does not emit on input when disabled', async () => {
      const wrapper = mountComponent({ disabled: true, type: 'text' });
      const input = wrapper.find('input');

      // Manually trigger input event since setValue might not work on disabled
      const inputEvent = new Event('input');
      Object.defineProperty(inputEvent, 'target', { value: { value: 'test' } });
      input.element.dispatchEvent(inputEvent);

      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });

    it('does not process keypress when disabled', async () => {
      const wrapper = mountComponent({ disabled: true, type: 'number' });
      const input = wrapper.find('input');

      const event = new KeyboardEvent('keypress', { key: 'e' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      input.element.dispatchEvent(event);

      // When disabled, onKeypress returns early without calling preventDefault
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('minValue computation', () => {
    it('returns 0 when onlyPositive is true and no min attr', () => {
      const wrapper = mountComponent({ onlyPositive: true, type: 'number' });
      expect(wrapper.find('input').attributes('min')).toBe('0');
    });

    it('returns 0 when min attr is negative', () => {
      const wrapper = mountComponent({ type: 'number', min: -5 });
      expect(wrapper.find('input').attributes('min')).toBe('0');
    });

    it('respects positive min attr', () => {
      const wrapper = mountComponent({ type: 'number', min: 10 });
      expect(wrapper.find('input').attributes('min')).toBe('10');
    });
  });

  describe('slots', () => {
    it('renders iconTrailing slot', () => {
      const wrapper = mountComponent({}, { iconTrailing: () => h('span', { class: 'icon' }, '$') });
      expect(wrapper.find('.icon').exists()).toBe(true);
    });

    it('renders iconLeading slot', () => {
      const wrapper = mountComponent({}, { iconLeading: () => h('span', { class: 'leading-icon' }, '@') });
      expect(wrapper.find('.leading-icon').exists()).toBe(true);
    });

    it('renders subLabel slot', () => {
      const wrapper = mountComponent({}, { subLabel: () => h('span', { class: 'sub-label' }, 'Help text') });
      expect(wrapper.find('.sub-label').exists()).toBe(true);
    });

    it('renders label-right slot', () => {
      const wrapper = mountComponent(
        { label: 'Field' },
        { 'label-right': () => h('span', { class: 'label-right' }, 'Optional') },
      );
      expect(wrapper.find('.label-right').exists()).toBe(true);
    });

    it('keeps the label wrapper when label-right is slotted', () => {
      const wrapper = mountComponent(
        { label: 'Field' },
        { 'label-right': () => h('span', { class: 'label-right' }, 'Optional') },
      );
      expect(wrapper.find('label.field-label').exists()).toBe(true);
    });
  });

  describe('nonLabelWrapper', () => {
    it('wraps the field in a label by default', () => {
      const wrapper = mountComponent({ label: 'Field' });
      expect(wrapper.find('label.field-label').exists()).toBe(true);
    });

    it('wraps the field in a div when enabled', () => {
      const wrapper = mountComponent({ label: 'Field', nonLabelWrapper: true });
      expect(wrapper.find('label.field-label').exists()).toBe(false);
      expect(wrapper.find('div.field-label').exists()).toBe(true);
    });
  });

  describe('external modelValue changes', () => {
    it('syncs display when modelValue changes externally', async () => {
      const wrapper = mountComponent({ modelValue: 100, type: 'number' });

      expect(wrapper.find('input').element.value).toBe('100');

      await wrapper.setProps({ modelValue: 200 });

      expect(wrapper.find('input').element.value).toBe('200');
    });

    it('clears display when modelValue becomes null', async () => {
      const wrapper = mountComponent({ modelValue: 100, type: 'number' });

      await wrapper.setProps({ modelValue: null });

      expect(wrapper.find('input').element.value).toBe('');
    });
  });

  describe('decimals prop', () => {
    const typeInto = async ({ wrapper, value }: { wrapper: ReturnType<typeof mountComponent>; value: string }) => {
      await wrapper.find('input').setValue(value);
    };

    it('drops digits past the currency decimals and emits the trimmed number', async () => {
      const wrapper = mountComponent({ type: 'number', decimals: 3 });

      await typeInto({ wrapper, value: '1.23456' });

      expect(wrapper.find('input').element.value).toBe('1.234');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([1.234]);
    });

    it('keeps a 3-decimal amount intact', async () => {
      const wrapper = mountComponent({ type: 'number', decimals: 3 });

      await typeInto({ wrapper, value: '1.234' });

      expect(wrapper.find('input').element.value).toBe('1.234');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([1.234]);
    });

    it('drops the decimal point for a whole-number currency', async () => {
      const wrapper = mountComponent({ type: 'number', decimals: 0 });

      await typeInto({ wrapper, value: '1500.6' });

      expect(wrapper.find('input').element.value).toBe('1500');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([1500]);
    });

    it('keeps every digit of a large whole-number amount (VND)', async () => {
      const wrapper = mountComponent({ type: 'number', decimals: 0 });

      await typeInto({ wrapper, value: '20500000000' });

      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([20_500_000_000]);
    });

    it('does not limit precision when decimals is unset', async () => {
      const wrapper = mountComponent({ type: 'number' });

      await typeInto({ wrapper, value: '0.00040641' });

      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([0.00040641]);
    });

    it('blocks the decimal point key for a whole-number currency', () => {
      const wrapper = mountComponent({ type: 'number', decimals: 0 });
      const event = new KeyboardEvent('keypress', { key: '.' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      wrapper.find('input').element.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('allows the decimal point key when the currency has decimals', () => {
      const wrapper = mountComponent({ type: 'number', decimals: 2 });
      const event = new KeyboardEvent('keypress', { key: '.' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      wrapper.find('input').element.dispatchEvent(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });
});
