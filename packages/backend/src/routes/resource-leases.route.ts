import { refreshResourceLeaseController } from '@controllers/resource-leases/refresh-resource-lease.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { resourceLeaseRefreshRateLimit } from '@middlewares/rate-limit';
import { Router } from 'express';

const router = Router({});

// No base-currency lock: extending a lease writes no financial data, and
// refusing it mid-wizard would drop the user's upload for nothing.
router.post('/refresh', authenticateSession, resourceLeaseRefreshRateLimit, refreshResourceLeaseController);

export default router;
