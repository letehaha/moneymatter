import { API_ERROR_CODES, API_RESPONSE_STATUS, ATTACHMENT_UPLOAD_TOKEN_HEADER } from '@bt/shared/types';
import { getCurrentSessionId } from '@common/lib/cls/session-id';
import { logger } from '@js/utils/logger';
import { captureException, setSentryUser } from '@js/utils/sentry';
import { authenticateSession, findAppUser } from '@middlewares/better-auth';
import { enforceReadOnly } from '@middlewares/entitlements';
import { resolveAttachmentUploadToken } from '@services/attachments/attachments.service';
import type { NextFunction, Request, Response } from 'express';

/**
 * Upload-route auth: an upload token authenticates as the user it was minted for, scoped to
 * the `:transactionId` in the path. Without the header the request is a normal session call.
 */
export const authenticateSessionOrUploadToken = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.get(ATTACHMENT_UPLOAD_TOKEN_HEADER);
  if (!token) return authenticateSession(req, res, next);

  try {
    const userId = await resolveAttachmentUploadToken({ token, transactionId: req.params.transactionId! });
    const user = userId ? await findAppUser({ where: { id: userId } }) : null;

    if (!user) {
      return res.status(401).json({
        status: API_RESPONSE_STATUS.error,
        response: {
          message: 'Upload token is invalid or expired. Call create_attachment_upload_url to get a new one.',
          code: API_ERROR_CODES.unauthorized,
        },
      });
    }

    req.user = user;
    setSentryUser({ userId: user.id, sessionId: getCurrentSessionId() });
  } catch (error) {
    logger.error({ message: 'Upload token authentication failed', error: error as Error });
    captureException({ error });

    return next(error);
  }

  return enforceReadOnly(req, res, next);
};
