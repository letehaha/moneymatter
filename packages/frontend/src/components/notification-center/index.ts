import { type Action, toast } from 'vue-sonner';

import { findLiveToast, pulseToast } from './toast-pulse';
import { registerToast, unregisterToast } from './toast-timers';

export enum NotificationType {
  warning,
  error,
  success,
  info,
}

type NotificationID = number | string;
interface Notification {
  id?: NotificationID;
  text: string;
  description?: string;
  type?: NotificationType;
  visibilityTime?: number;
  /** Never auto-hides. Use for actionable errors the user must not miss. */
  persistent?: boolean;
  /**
   * Renders a button inside the toast, e.g. a link to the record that failed. Sonner renders the label
   * as text only, so `icon` is drawn by the `toast-action-icon-*` rules in the toaster styles.
   */
  action?: Action & { icon?: 'undo' };
}

const DEFAULT_VISIBILITY_TIME = 4000;

const TOAST_BY_TYPE = {
  [NotificationType.warning]: toast.warning,
  [NotificationType.error]: toast.error,
  [NotificationType.success]: toast.success,
  [NotificationType.info]: toast.info,
};

/**
 * Sonner keeps a dismissed toast's id bound to the dying card for ~500ms: a raise under that id is
 * swallowed and corrupts the stack's height bookkeeping. So the caller-facing id is only a lookup
 * key, and the id sonner sees is minted fresh for every raise that is not replacing a live toast.
 */
const activeSonnerIds = new Map<NotificationID, NotificationID>();
/** Lets a plain raise find the live toast an explicit id is holding the same text under. */
const explicitIdByTextKey = new Map<string, NotificationID>();
let sonnerIdCounter = 0;

/** Persistent toasts outlive every timer, so logout needs a handle on the ones still on screen. */
const persistentBaseIds = new Set<NotificationID>();

const releaseActiveId = ({ baseId, sonnerId }: { baseId: NotificationID; sonnerId: NotificationID }) => {
  if (activeSonnerIds.get(baseId) !== sonnerId) return;

  activeSonnerIds.delete(baseId);
  persistentBaseIds.delete(baseId);
  explicitIdByTextKey.forEach((heldBy, textKey) => {
    if (heldBy === baseId) explicitIdByTextKey.delete(textKey);
  });
};

const dismissNotification = ({ id }: { id?: NotificationID }) => {
  // Any falsy id reaches sonner's dismiss-everything branch and clears the whole stack.
  if (!id) return;

  const sonnerId = activeSonnerIds.get(id) ?? id;

  releaseActiveId({ baseId: id, sonnerId });
  unregisterToast({ id: sonnerId });
  toast.dismiss(sonnerId);
};

export const dismissPersistentNotifications = () => {
  persistentBaseIds.forEach((id) => dismissNotification({ id }));
  persistentBaseIds.clear();
};

export const useNotificationCenter = (): {
  addNotification: (notification: Notification) => NotificationID;
  removeNotification: (id?: NotificationID) => void;
  addSuccessNotification: (message: string) => void;
  addWarningNotification: (message: string) => void;
  addErrorNotification: (message: string) => void;
  addInfoNotification: (message: string) => void;
} => {
  const removeNotification = (id?: NotificationID) => dismissNotification({ id });

  // Deriving the id from type + text + description keeps identical notifications down to a single
  // visible toast, since a raise under a live toast's id replaces it in place. A plain raise of text
  // a live explicit-id toast already shows folds into that toast, keeping its action.
  // Sonner's countdown only pauses and resumes, so it gets Infinity and `toast-timers` owns dismissal.
  const addNotification = ({
    id,
    text,
    description,
    type = NotificationType.info,
    visibilityTime,
    persistent,
    action,
  }: Notification): NotificationID => {
    const textKey = `${type}:${text}:${description ?? ''}`;
    const heldByExplicitId = id ? undefined : explicitIdByTextKey.get(textKey);

    const heldSonnerId = heldByExplicitId === undefined ? undefined : activeSonnerIds.get(heldByExplicitId);

    if (heldByExplicitId !== undefined && heldSonnerId !== undefined) {
      const liveToastEl = findLiveToast({ id: String(heldByExplicitId) });
      if (liveToastEl) pulseToast({ element: liveToastEl });

      // A fold is a repeat the user must get a full read of, and the held toast may be
      // milliseconds from expiring, so its countdown restarts like any other re-raise.
      if (!persistentBaseIds.has(heldByExplicitId)) {
        registerToast({
          id: heldSonnerId,
          durationMs: visibilityTime ?? DEFAULT_VISIBILITY_TIME,
          onExpire: () => releaseActiveId({ baseId: heldByExplicitId, sonnerId: heldSonnerId }),
        });
      }

      return heldByExplicitId;
    }

    const baseId = id || textKey;
    const activeId = activeSonnerIds.get(baseId);
    const sonnerId = activeId ?? `${baseId}#${sonnerIdCounter++}`;

    // Replacing a live toast leaves the screen unchanged, so the pulse is the only sign it happened.
    // A raise that mints an id lands as a new card with its own entry animation.
    const replacedToastEl = activeId === undefined ? null : findLiveToast({ id: String(baseId) });

    activeSonnerIds.set(baseId, sonnerId);
    if (id) explicitIdByTextKey.set(textKey, baseId);

    TOAST_BY_TYPE[type](text, {
      id: sonnerId,
      testId: String(baseId),
      description,
      action,
      classes: action?.icon ? { actionButton: `toast-action-icon-${action.icon}` } : undefined,
      duration: Infinity,
      onDismiss: () => {
        releaseActiveId({ baseId, sonnerId });
        unregisterToast({ id: sonnerId });
      },
    });

    if (replacedToastEl) pulseToast({ element: replacedToastEl });

    if (persistent) {
      persistentBaseIds.add(baseId);
      unregisterToast({ id: sonnerId });
    } else {
      persistentBaseIds.delete(baseId);
      registerToast({
        id: sonnerId,
        durationMs: visibilityTime ?? DEFAULT_VISIBILITY_TIME,
        onExpire: () => releaseActiveId({ baseId, sonnerId }),
      });
    }

    return baseId;
  };

  const addSuccessNotification = (message: string) => {
    addNotification({
      text: message,
      type: NotificationType.success,
    });
  };

  const addWarningNotification = (message: string) => {
    addNotification({
      text: message,
      type: NotificationType.warning,
    });
  };

  const addErrorNotification = (message: string) => {
    addNotification({
      text: message,
      type: NotificationType.error,
    });
  };

  const addInfoNotification = (message: string) => {
    addNotification({
      text: message,
      type: NotificationType.info,
    });
  };

  return {
    addNotification,
    removeNotification,

    addSuccessNotification,
    addWarningNotification,
    addErrorNotification,
    addInfoNotification,
  };
};
