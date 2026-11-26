import { deliverDueGifts } from '@services/billing/gifts/deliver-gifts.service';

import { createScheduledSync } from './lib/create-scheduled-sync';

/** Hourly, so a gift scheduled for a morning in the buyer's timezone lands that morning. */
export const giftDeliveryCron = createScheduledSync({
  name: 'scheduled gift delivery',
  cronExpression: '5 * * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs hourly at :05',
  errorCode: 'GIFT_DELIVERY_CRON',
  run: deliverDueGifts,
});
