import {
  deletePushSubscription,
  getPushConfig,
  listPushSubscriptions,
  sendTestPushNotification,
  subscribePush,
  syncPushSubscription,
  unsubscribePush,
} from '@controllers/web-push.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { webPushSubscriptionRateLimit, webPushTestRateLimit } from '@middlewares/rate-limit';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

// None of the writes carries `checkBaseCurrencyLock`: they register a device and touch no
// monetary data, and turning notifications on or off has to work during a base-currency change.

router.get('/config', getPushConfig);

router.get('/subscriptions', listPushSubscriptions);

// Enable, or Rotate when the body carries `oldEndpoint`.
router.post('/subscriptions', blockDemoUsers, webPushSubscriptionRateLimit, subscribePush);

router.post('/subscriptions/sync', webPushSubscriptionRateLimit, syncPushSubscription);

router.post('/subscriptions/unsubscribe', webPushSubscriptionRateLimit, unsubscribePush);

router.delete('/subscriptions/:id', webPushSubscriptionRateLimit, deletePushSubscription);

router.post('/test', blockDemoUsers, webPushTestRateLimit, sendTestPushNotification);

export default router;
