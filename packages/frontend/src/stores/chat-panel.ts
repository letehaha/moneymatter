import { defineStore } from 'pinia';
import { ref } from 'vue';

export const CHAT_PANEL_MIN_WIDTH = 360;
export const CHAT_PANEL_MAX_WIDTH = 560;
export const CHAT_PANEL_DEFAULT_WIDTH = 420;
export const CHAT_PANEL_STORAGE_KEY = 'chat-panel';

interface StoredPanelState {
  isOpen: boolean;
  width: number;
}

const clampWidth = ({ value }: { value: number }) =>
  Math.min(CHAT_PANEL_MAX_WIDTH, Math.max(CHAT_PANEL_MIN_WIDTH, Math.round(value)));

const isWithinBounds = (value: unknown): value is number =>
  typeof value === 'number' && value >= CHAT_PANEL_MIN_WIDTH && value <= CHAT_PANEL_MAX_WIDTH;

/** Storage can be missing, full or blocked (private windows, site data off); the panel works without it. */
const readStoredState = (): StoredPanelState => {
  const fallback = { isOpen: false, width: CHAT_PANEL_DEFAULT_WIDTH };
  try {
    const raw = localStorage.getItem(CHAT_PANEL_STORAGE_KEY);
    if (!raw) return fallback;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;

    const { isOpen, width } = parsed as Record<string, unknown>;
    return {
      isOpen: isOpen === true,
      width: isWithinBounds(width) ? width : CHAT_PANEL_DEFAULT_WIDTH,
    };
  } catch {
    return fallback;
  }
};

/** The docked chat panel of the desktop layout: whether it is open and how wide, both remembered. */
export const useChatPanelStore = defineStore('chat-panel', () => {
  const stored = readStoredState();
  const isOpen = ref(stored.isOpen);
  const width = ref(stored.width);
  /** The conversation the panel shows. It lasts for the session only: a reload starts a new chat. */
  const threadId = ref<string | null>(null);

  const persist = () => {
    try {
      localStorage.setItem(CHAT_PANEL_STORAGE_KEY, JSON.stringify({ isOpen: isOpen.value, width: width.value }));
    } catch {
      // The state still holds for this session.
    }
  };

  const open = () => {
    isOpen.value = true;
    persist();
  };

  const close = () => {
    isOpen.value = false;
    persist();
  };

  const toggle = () => {
    isOpen.value = !isOpen.value;
    persist();
  };

  const setWidth = (value: number) => {
    width.value = clampWidth({ value });
    persist();
  };

  const setThread = ({ threadId: id }: { threadId: string | null }) => {
    threadId.value = id;
  };

  return { isOpen, width, threadId, open, close, toggle, setWidth, setThread };
});
