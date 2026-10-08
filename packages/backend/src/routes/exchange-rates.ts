import getPairRate from '@controllers/exchange-rates/pair-rate.controller';
import getExchangeRatesForDate from '@controllers/exchange-rates/rates-for-date.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { Router } from 'express';

const router = Router({});

// Must stay above '/:date', which would otherwise match "pair" as a date.
router.get('/pair', authenticateSession, getPairRate);

router.get('/:date', authenticateSession, getExchangeRatesForDate);

export default router;
