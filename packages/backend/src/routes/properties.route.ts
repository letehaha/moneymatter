import createProperty from '@controllers/properties/create-property';
import deleteProperty from '@controllers/properties/delete-property';
import getProperties from '@controllers/properties/get-properties';
import getProperty from '@controllers/properties/get-property';
import updateProperty from '@controllers/properties/update-property';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

router.get('/', getProperties);
router.get('/:id', getProperty);
router.post('/', checkBaseCurrencyLock, createProperty);
router.patch('/:id', checkBaseCurrencyLock, updateProperty);
router.delete('/:id', checkBaseCurrencyLock, deleteProperty);

export default router;
