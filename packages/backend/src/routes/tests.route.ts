import { API_RESPONSE_STATUS } from '@bt/shared/types';
import { authPool } from '@config/auth';
import { errorHandler } from '@controllers/helpers';
import { authenticateSession } from '@middlewares/better-auth';
import { createAttachmentUploadToken } from '@services/attachments/attachments.service';
import { syncCoingeckoRates } from '@services/currencies/rate-sources/coingecko-sync';
import { syncHttpRates } from '@services/currencies/rate-sources/http-sync';
import { syncExchangeRates } from '@services/exchange-rates/sync-exchange-rates';
import { Router } from 'express';

const router = Router();

// oxlint-disable-next-line oxc/no-async-endpoint-handlers – used only in tests
router.get('/exchange-rates/sync', authenticateSession, async (req, res) => {
  try {
    await syncExchangeRates();

    return res.status(200).json({
      status: API_RESPONSE_STATUS.success,
    });
  } catch (err) {
    errorHandler(res, err as Error);
  }
});

// oxlint-disable-next-line oxc/no-async-endpoint-handlers – used only in tests
router.get('/currency-rate-sources/sync', authenticateSession, async (req, res) => {
  try {
    const { source } = req.query;
    if (source !== 'coingecko' && source !== 'http') {
      return res.status(400).json({
        status: API_RESPONSE_STATUS.error,
        response: { message: 'source must be coingecko or http' },
      });
    }

    const result = source === 'coingecko' ? await syncCoingeckoRates({ spacingMs: 0 }) : await syncHttpRates();

    return res.status(200).json({ status: API_RESPONSE_STATUS.success, response: result });
  } catch (err) {
    errorHandler(res, err as Error);
  }
});

// oxlint-disable-next-line oxc/no-async-endpoint-handlers – used only in tests
router.post('/verify-email', async (req, res) => {
  try {
    const { email } = req.body as { email: string };

    if (!email) {
      return res.status(400).json({
        status: API_RESPONSE_STATUS.error,
        response: { message: 'email is required' },
      });
    }

    await authPool.query('UPDATE ba_user SET "emailVerified" = true WHERE email = $1', [email]);

    return res.status(200).json({
      status: API_RESPONSE_STATUS.success,
    });
  } catch (err) {
    errorHandler(res, err as Error);
  }
});

// Upload tokens are minted by an MCP tool, and the MCP SDK is mocked under Jest.
// oxlint-disable-next-line oxc/no-async-endpoint-handlers – used only in tests
router.post('/attachment-upload-token', authenticateSession, async (req, res) => {
  try {
    const { transactionId } = req.body as { transactionId: string };
    const token = await createAttachmentUploadToken({ userId: req.user!.id, transactionId });

    return res.status(200).json({ status: API_RESPONSE_STATUS.success, response: { token } });
  } catch (err) {
    errorHandler(res, err as Error);
  }
});

export default router;
