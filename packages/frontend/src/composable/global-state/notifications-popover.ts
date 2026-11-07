import { ref } from 'vue';

/** The header bell's popover. Opening a notification that has no target leaves it open on the dashboard. */
export const isNotificationsPopoverOpen = ref(false);
