import getAllCurrencies from '@controllers/currencies.controller';
import { Router } from 'express';

const router = Router({});

router.get('/', getAllCurrencies);

export default router;
