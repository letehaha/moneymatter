import { API_ERROR_CODES, API_RESPONSE_STATUS } from '@bt/shared/types';
import { ERROR_CODES } from '@js/errors';
import Users from '@models/users.model';
import type { NextFunction, Request, Response } from 'express';

const parseAdminUsers = (): string[] =>
  (process.env.ADMIN_USERS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

/**
 * Whether a username is an admin, per the ADMIN_USERS env list. Single source of truth: the
 * middleware, the profile `isAdmin` flag, and the reserved-username guard all route through
 * here so the parsing cannot drift and a mismatch cannot open an escalation.
 */
export const isAdminUsername = ({ username }: { username?: string | null }): boolean =>
  Boolean(username) && parseAdminUsers().includes(username as string);

/** Whether `ADMIN_USERS` names at least one admin. */
export const hasConfiguredAdmins = (): boolean => parseAdminUsers().length > 0;

/**
 * Middleware to ensure an endpoint is only accessible by admin users.
 * Returns a 401 Unauthorized error when the caller is not an admin.
 */
export const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!hasConfiguredAdmins()) {
    return res.status(ERROR_CODES.Unauthorized).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message: 'Admin functionality is not configured.',
        code: API_ERROR_CODES.unauthorized,
      },
    });
  }

  // Assumes user is already authenticated via authenticateSession middleware
  const username = (req.user as Users)?.username;

  if (!username) {
    return res.status(ERROR_CODES.Unauthorized).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message: 'Authentication required.',
        code: API_ERROR_CODES.unauthorized,
      },
    });
  }

  if (!isAdminUsername({ username })) {
    return res.status(ERROR_CODES.Unauthorized).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message: 'Admin privileges required.',
        code: API_ERROR_CODES.unauthorized,
      },
    });
  }

  return next();
};
