import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { createI18n } from 'vue-i18n';

import ResponsiveDialog from './responsive-dialog.vue';

const { isMobile } = vi.hoisted(() => ({ isMobile: { value: false } }));

vi.mock('@/composable/window-breakpoints', () => ({
  CUSTOM_BREAKPOINTS: { uiMobile: 'uiMobile' },
  useWindowBreakpoints: () => computed(() => isMobile.value),
}));

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } });

const mountDialog = ({ dismissible }: { dismissible: boolean }) => {
  const onUpdateOpen = vi.fn();
  const onDismissBlocked = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup: () => {
        const open = ref(true);
        return () =>
          h(
            ResponsiveDialog,
            {
              open: open.value,
              dismissible,
              'onUpdate:open': (value: boolean) => {
                onUpdateOpen(value);
                open.value = value;
              },
              onDismissBlocked,
            },
            {
              title: () => 'Title',
              default: ({ close }: { close: () => void }) =>
                h('button', { 'data-testid': 'slot-close', onClick: close }, 'Done'),
            },
          );
      },
    }),
    { attachTo: document.body, global: { plugins: [i18n] } },
  );
  return { wrapper, onUpdateOpen, onDismissBlocked };
};

const pressEscape = async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await flushPromises();
};

describe('ResponsiveDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe.each([
    ['dialog', false],
    ['drawer', true],
  ])('as a %s', (_mode, mobile) => {
    it('reports a blocked ESC instead of closing while not dismissible', async () => {
      isMobile.value = mobile;
      const { wrapper, onUpdateOpen, onDismissBlocked } = mountDialog({ dismissible: false });
      await flushPromises();

      await pressEscape();

      expect(onDismissBlocked).toHaveBeenCalledOnce();
      expect(onUpdateOpen).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('reports a blocked outside press instead of closing while not dismissible', async () => {
      isMobile.value = mobile;
      const { wrapper, onUpdateOpen, onDismissBlocked } = mountDialog({ dismissible: false });
      await flushPromises();

      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();

      expect(onDismissBlocked).toHaveBeenCalledOnce();
      expect(onUpdateOpen).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('closes on ESC while dismissible', async () => {
      isMobile.value = mobile;
      const { wrapper, onUpdateOpen, onDismissBlocked } = mountDialog({ dismissible: true });
      await flushPromises();

      await pressEscape();

      expect(onUpdateOpen).toHaveBeenCalledWith(false);
      expect(onDismissBlocked).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });

  it.each([
    [true, [[false]]],
    [false, []],
  ])('closes from the slot only while dismissible (%s), without reporting a block', async (dismissible, updates) => {
    isMobile.value = false;
    const { wrapper, onUpdateOpen, onDismissBlocked } = mountDialog({ dismissible });
    await flushPromises();

    (document.querySelector('[data-testid="slot-close"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(onUpdateOpen.mock.calls).toEqual(updates);
    expect(onDismissBlocked).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('reports a blocked close button in the dialog', async () => {
    isMobile.value = false;
    const { wrapper, onUpdateOpen, onDismissBlocked } = mountDialog({ dismissible: false });
    await flushPromises();

    (document.querySelector('[role="dialog"] button:not([data-testid="slot-close"])') as HTMLButtonElement).click();
    await flushPromises();

    expect(onDismissBlocked).toHaveBeenCalledOnce();
    expect(onUpdateOpen).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
