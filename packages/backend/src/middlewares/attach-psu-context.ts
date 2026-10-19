import { requestContext } from '@common/request-context';
import { isPublicIpAddress } from '@common/utils/url-guard';
import type { NextFunction, Request, Response } from 'express';

/**
 * Marks the request as PSU-present so bank API calls forward the user's IP and user agent.
 * Apply only to routes the user triggers directly; background refreshes must stay unattended.
 * Banks reject a non-public PSU IP (self-host reached over LAN/Docker), so those stay unattended too.
 */
export const attachPsuContext = (req: Request, _res: Response, next: NextFunction) => {
  const context = requestContext.getContext();
  const ipAddress = req.ip?.replace(/^::ffff:/, '');
  const userAgent = req.get('user-agent');

  if (context && ipAddress && userAgent && isPublicIpAddress({ ip: ipAddress })) {
    context.psu = { ipAddress, userAgent };
  }

  next();
};
