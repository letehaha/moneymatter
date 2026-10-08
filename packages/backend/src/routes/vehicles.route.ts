import createVehicle from '@controllers/vehicles/create-vehicle';
import deleteVehicle from '@controllers/vehicles/delete-vehicle';
import getVehicle from '@controllers/vehicles/get-vehicle';
import getVehicles from '@controllers/vehicles/get-vehicles';
import updateVehicle from '@controllers/vehicles/update-vehicle';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

router.get('/', getVehicles);
router.get('/:id', getVehicle);
router.post('/', checkBaseCurrencyLock, createVehicle);
router.patch('/:id', checkBaseCurrencyLock, updateVehicle);
router.delete('/:id', checkBaseCurrencyLock, deleteVehicle);

export default router;
