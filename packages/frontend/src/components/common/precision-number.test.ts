import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PrecisionNumber from './precision-number.vue';

// Stub `ResponsiveTooltip` so the test stays focused on PrecisionNumber's
// reveal-vs-plain rendering decisions without dragging Popover/Tooltip primitives
// (and their `useMediaQuery` runtime branching) into the test environment.
const ResponsiveTooltipStub = {
  name: 'ResponsiveTooltip',
  props: ['content'],
  template: `<div data-testid="tooltip" :data-content="content"><slot /></div>`,
};

const mountIt = (props: { value: string | number; maxDecimals: number; triggerClass?: string }) =>
  mount(PrecisionNumber, {
    props,
    global: {
      stubs: { ResponsiveTooltip: ResponsiveTooltipStub },
    },
  });

const localized = ({ value, decimals }: { value: number; decimals: number }) =>
  value.toLocaleString('en-US', { maximumFractionDigits: decimals });

describe('PrecisionNumber', () => {
  describe('rendering', () => {
    it('renders plain text when raw value fits within max decimals', () => {
      const wrapper = mountIt({ value: '1.23', maxDecimals: 2 });

      expect(wrapper.find('[data-testid="tooltip"]').exists()).toBe(false);
      expect(wrapper.text()).toBe(localized({ value: 1.23, decimals: 2 }));
    });

    it('renders plain text when fractional zeros pad beyond max decimals but signify nothing', () => {
      const wrapper = mountIt({ value: '5418.0000000000', maxDecimals: 4 });

      expect(wrapper.find('[data-testid="tooltip"]').exists()).toBe(false);
      expect(wrapper.text()).toBe(localized({ value: 5418, decimals: 4 }));
    });

    it('wraps in a tooltip when raw value has more decimals than allowed', () => {
      const wrapper = mountIt({ value: '-0.0004920000', maxDecimals: 4 });

      const tooltip = wrapper.find('[data-testid="tooltip"]');
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.attributes('data-content')).toBe('-0.000492');
      expect(tooltip.text()).toBe(localized({ value: -0.0005, decimals: 4 }));
    });
  });

  describe('tooltip trigger styling', () => {
    it('underlines the trigger with a dotted decoration and a help cursor', () => {
      const wrapper = mountIt({ value: '1.234', maxDecimals: 2 });

      const trigger = wrapper.find('[data-testid="tooltip"] span');
      expect(trigger.exists()).toBe(true);
      expect(trigger.classes()).toEqual(
        expect.arrayContaining(['cursor-help', 'underline', 'decoration-dotted', 'underline-offset-4']),
      );
    });

    it('merges a caller-supplied triggerClass with the default styles', () => {
      const wrapper = mountIt({ value: '1.234', maxDecimals: 2, triggerClass: 'text-app-expense-color' });

      const trigger = wrapper.find('[data-testid="tooltip"] span');
      expect(trigger.classes()).toEqual(expect.arrayContaining(['cursor-help', 'text-app-expense-color']));
    });
  });

  describe('input handling', () => {
    it('accepts a numeric value the same way as a string', () => {
      const wrapper = mountIt({ value: 1.23456, maxDecimals: 2 });

      const tooltip = wrapper.find('[data-testid="tooltip"]');
      expect(tooltip.exists()).toBe(true);
      // Number.prototype.toString() keeps the same digits, so the tooltip content
      // matches the literal precision the caller passed in.
      expect(tooltip.attributes('data-content')).toBe('1.23456');
      expect(tooltip.text()).toBe(localized({ value: 1.23, decimals: 2 }));
    });

    it('reacts to prop updates by swapping tooltip on / off', async () => {
      const wrapper = mountIt({ value: '1.23', maxDecimals: 2 });
      expect(wrapper.find('[data-testid="tooltip"]').exists()).toBe(false);

      await wrapper.setProps({ value: '1.2345' });
      expect(wrapper.find('[data-testid="tooltip"]').exists()).toBe(true);

      await wrapper.setProps({ value: '1.2' });
      expect(wrapper.find('[data-testid="tooltip"]').exists()).toBe(false);
    });
  });
});
