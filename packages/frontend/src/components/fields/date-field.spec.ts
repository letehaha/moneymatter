import { mount } from '@vue/test-utils';

import DateField from './date-field.vue';

const CalendarStub = {
  name: 'CalendarStub',
  props: { modelValue: { type: Date, default: undefined } },
  emits: ['update:modelValue'],
  template: '<div />',
};

const SlotStub = { template: '<div><slot /></div>' };

const mountComponent = (props: {
  modelValue: Date;
  mode?: 'date' | 'dateTime';
  calendarOptions?: { minDate?: Date; maxDate?: Date };
}) =>
  mount(DateField, {
    props,
    global: {
      stubs: { Popover: SlotStub, PopoverTrigger: SlotStub, PopoverContent: SlotStub, Calendar: CalendarStub },
    },
  });

describe('DateField component', () => {
  it('does not emit update:modelValue when the calendar clears its selection', async () => {
    const modelValue = new Date('2024-05-10T12:00:00.000Z');
    const wrapper = mountComponent({ modelValue });

    const calendar = wrapper.findComponent({ name: 'CalendarStub' });
    calendar.vm.$emit('update:modelValue', null);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(calendar.props('modelValue')).toEqual(modelValue);
  });

  it('does not emit dates before year 2000 typed into the input', async () => {
    const wrapper = mountComponent({ modelValue: new Date('2026-08-22T10:00:00') });

    const input = wrapper.find('input[type="datetime-local"]');
    await input.setValue('0026-08-22 10:00');

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('emits dates from year 2000 onward typed into the input', async () => {
    const wrapper = mountComponent({ modelValue: new Date('2026-08-22T10:00:00') });

    const input = wrapper.find('input[type="datetime-local"]');
    await input.setValue('2000-01-01 10:00');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([new Date('2000-01-01 10:00')]);
  });

  it('reverts a pre-2000 date to the last valid value on blur', async () => {
    const modelValue = new Date('2026-08-22T10:00:00');
    const wrapper = mountComponent({ modelValue });

    const input = wrapper.find('input[type="datetime-local"]');
    await input.setValue('0026-08-22 10:00');
    await input.trigger('blur');

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    // The native datetime-local getter canonicalizes to the T separator.
    expect((input.element as HTMLInputElement).value).toBe('2026-08-22T10:00');
  });

  it('keeps the 4-digit-year cap and no min when no calendar bounds are given', () => {
    const wrapper = mountComponent({ modelValue: new Date('2026-08-22T10:00:00') });

    const input = wrapper.find('input[type="datetime-local"]');
    expect(input.attributes('max')).toBe('9999-12-31T23:59');
    expect(input.attributes('min')).toBeUndefined();
  });

  it('does not bind the calendar bounds to the native datetime input', () => {
    const wrapper = mountComponent({
      modelValue: new Date('2026-08-22T10:00:00'),
      calendarOptions: { minDate: new Date(2026, 0, 5, 8, 30), maxDate: new Date(2026, 11, 24, 18, 45) },
    });

    const input = wrapper.find('input[type="datetime-local"]');
    expect(input.attributes('min')).toBeUndefined();
    expect(input.attributes('max')).toBe('9999-12-31T23:59');
  });

  describe('date mode', () => {
    it('renders a date-only input bounded by the calendar options', () => {
      const wrapper = mountComponent({
        modelValue: new Date(2026, 7, 22, 10, 0),
        mode: 'date',
        calendarOptions: { minDate: new Date(2026, 0, 5, 8, 30), maxDate: new Date(2026, 11, 24, 18, 45) },
      });

      const input = wrapper.find('input[type="date"]');
      expect((input.element as HTMLInputElement).value).toBe('2026-08-22');
      expect(input.attributes('min')).toBe('2026-01-05');
      expect(input.attributes('max')).toBe('2026-12-24');
      expect(wrapper.findComponent({ name: 'CalendarStub' }).attributes('mode')).toBe('date');
    });

    it('emits a typed date as local midnight', async () => {
      const wrapper = mountComponent({ modelValue: new Date(2026, 7, 22), mode: 'date' });

      await wrapper.find('input[type="date"]').setValue('2026-03-01');

      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([new Date(2026, 2, 1)]);
    });
  });
});
