import createDealController from '@controllers/venture/deals/create-deal.controller';
import deleteDealController from '@controllers/venture/deals/delete-deal.controller';
import getDealMetricsController from '@controllers/venture/deals/get-deal-metrics.controller';
import getDealController from '@controllers/venture/deals/get-deal.controller';
import listDealsController from '@controllers/venture/deals/list-deals.controller';
import updateDealController from '@controllers/venture/deals/update-deal.controller';
import appendLinksController from '@controllers/venture/events/append-links.controller';
import createEventController from '@controllers/venture/events/create-event.controller';
import deleteEventController from '@controllers/venture/events/delete-event.controller';
import deleteLinkController from '@controllers/venture/events/delete-link.controller';
import getEventController from '@controllers/venture/events/get-event.controller';
import listEventsController from '@controllers/venture/events/list-events.controller';
import replaceLinksController from '@controllers/venture/events/replace-links.controller';
import updateEventController from '@controllers/venture/events/update-event.controller';
import createPlatformController from '@controllers/venture/platforms/create-platform.controller';
import deletePlatformController from '@controllers/venture/platforms/delete-platform.controller';
import getPlatformController from '@controllers/venture/platforms/get-platform.controller';
import listPlatformsController from '@controllers/venture/platforms/list-platforms.controller';
import updatePlatformController from '@controllers/venture/platforms/update-platform.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

// Platforms
router.get('/platforms', listPlatformsController);
router.get('/platforms/:id', getPlatformController);
router.post('/platforms', checkBaseCurrencyLock, createPlatformController);
router.put('/platforms/:id', checkBaseCurrencyLock, updatePlatformController);
router.delete('/platforms/:id', checkBaseCurrencyLock, deletePlatformController);

// Deals
router.get('/deals', listDealsController);
router.get('/deals/:id', getDealController);
router.get('/deals/:id/metrics', getDealMetricsController);
router.post('/deals', checkBaseCurrencyLock, createDealController);
router.put('/deals/:id', checkBaseCurrencyLock, updateDealController);
router.delete('/deals/:id', checkBaseCurrencyLock, deleteDealController);

// Events
router.get('/deals/:dealId/events', listEventsController);
router.post('/deals/:dealId/events', checkBaseCurrencyLock, createEventController);
router.get('/events/:id', getEventController);
router.put('/events/:id', checkBaseCurrencyLock, updateEventController);
router.delete('/events/:id', checkBaseCurrencyLock, deleteEventController);

// Event links
router.post('/events/:id/links', checkBaseCurrencyLock, appendLinksController);
router.put('/events/:id/links', checkBaseCurrencyLock, replaceLinksController);
router.delete('/events/:id/links/:linkId', checkBaseCurrencyLock, deleteLinkController);

export default router;
