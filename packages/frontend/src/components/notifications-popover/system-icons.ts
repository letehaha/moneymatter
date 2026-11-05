import { SYSTEM_NOTIFICATION_ICONS, type SystemNotificationIcon } from '@bt/shared/types';
import { AlertTriangleIcon, CircleCheckIcon, InfoIcon, MegaphoneIcon } from '@lucide/vue';
import type { Component } from 'vue';

export const SYSTEM_ICON_VISUALS = {
  [SYSTEM_NOTIFICATION_ICONS.info]: { icon: InfoIcon, bg: 'bg-blue-500' },
  [SYSTEM_NOTIFICATION_ICONS.announcement]: { icon: MegaphoneIcon, bg: 'bg-purple-500' },
  [SYSTEM_NOTIFICATION_ICONS.success]: { icon: CircleCheckIcon, bg: 'bg-app-income-color' },
  [SYSTEM_NOTIFICATION_ICONS.warning]: { icon: AlertTriangleIcon, bg: 'bg-orange-500' },
} satisfies Record<SystemNotificationIcon, { icon: Component; bg: string }>;

// Stored payloads are untyped JSON, so an unknown value still falls back to info.
export const getSystemIconVisual = (icon: SystemNotificationIcon | undefined) =>
  SYSTEM_ICON_VISUALS[icon ?? SYSTEM_NOTIFICATION_ICONS.info] ?? SYSTEM_ICON_VISUALS.info;
