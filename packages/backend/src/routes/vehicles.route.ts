import createVehicle from '@controllers/vehicles/create-vehicle';
import deleteVehicle from '@controllers/vehicles/delete-vehicle';
import getVehicle from '@controllers/vehicles/get-vehicle';
import getVehicles from '@controllers/vehicles/get-vehicles';
import updateVehicle from '@controllers/vehicles/update-vehicle';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.get('/', authenticateSession, getVehicles);
router.get('/:id', authenticateSession, getVehicle);
router.post('/', authenticateSession, checkBaseCurrencyLock, createVehicle);
router.patch('/:id', authenticateSession, checkBaseCurrencyLock, updateVehicle);
router.delete('/:id', authenticateSession, checkBaseCurrencyLock, deleteVehicle);

export default router;
