import enLayout from '@/i18n/locales/chunks/en/layout.json';
import { ROUTES_NAMES } from '@/routes/constants';
import { useChatPanelStore } from '@/stores/chat-panel';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, reactive, ref } from 'vue';
import { createI18n } from 'vue-i18n';

import ChatHeaderButton from './chat-header-button.vue';

const route = reactive({ name: ROUTES_NAMES.account as string });
const push = vi.fn();
const isMobile = ref(false);
const context = ref<object>({ route: ROUTES_NAMES.account, entity: { kind: 'account', id: 'a1' } });

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push }) }));
vi.mock('@/composable/window-breakpoints', () => ({
  CUSTOM_BREAKPOINTS: { uiMobile: 767 },
  useWindowBreakpoints: () => isMobile,
}));
vi.mock('@/composable/chat/use-chat-page-context', () => ({
  useChatPageContext: () => ({ context: computed(() => context.value) }),
  chatPageContextToQuery: ({ context: value }: { context: object }) => ({ context: JSON.stringify(value) }),
}));

const mountButton = () =>
  mount(ChatHeaderButton, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: enLayout }, missingWarn: false })],
      stubs: { DesktopOnlyTooltip: { template: '<div><slot /></div>' } },
    },
  });

describe('ChatHeaderButton', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    push.mockReset();
    route.name = ROUTES_NAMES.account;
    isMobile.value = false;
    context.value = { route: ROUTES_NAMES.account, entity: { kind: 'account', id: 'a1' } };
  });

  it('opens and closes the panel on a wide screen', async () => {
    const store = useChatPanelStore();
    const wrapper = mountButton();

    await wrapper.find('button').trigger('click');
    expect(store.isOpen).toBe(true);
    expect(wrapper.find('button').attributes('aria-pressed')).toBe('true');

    await wrapper.find('button').trigger('click');
    expect(store.isOpen).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('opens the Chat page with the page context on a narrow screen', async () => {
    isMobile.value = true;

    await mountButton().find('button').trigger('click');

    expect(push).toHaveBeenCalledWith({
      name: ROUTES_NAMES.chat,
      query: { context: JSON.stringify(context.value) },
    });
    expect(useChatPanelStore().isOpen).toBe(false);
  });

  it('opens the Chat page without a context when the page tells nothing', async () => {
    isMobile.value = true;
    context.value = {};

    await mountButton().find('button').trigger('click');

    expect(push).toHaveBeenCalledWith({ name: ROUTES_NAMES.chat });
  });

  it('is not shown on the Chat page itself', () => {
    route.name = ROUTES_NAMES.chat;
    expect(mountButton().find('button').exists()).toBe(false);

    route.name = ROUTES_NAMES.chatThread;
    expect(mountButton().find('button').exists()).toBe(false);
  });

  it('is labelled for assistive technology', () => {
    expect(mountButton().find('button').attributes('aria-label')).toBe('Open AI chat');
  });

  it('shows the shared AI chat icon', () => {
    const icon = mountButton().find('button svg');

    expect(icon.classes()).toContain('lucide-bot-message-square');
  });
});
