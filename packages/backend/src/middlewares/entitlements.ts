import { API_ERROR_CODES, API_RESPONSE_STATUS, Entitlements, FEATURES, Feature } from '@bt/shared/types';
import { ERROR_CODES } from '@js/errors';
import { API_PREFIX } from '@root/config';
import { type FeatureAccess, getFeatureAccess } from '@services/entitlements/feature-trial.service';
import { resolveEntitlements } from '@services/entitlements/resolve-entitlements.service';
import type { NextFunction, Request, Response } from 'express';

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

type WriteMethod = (typeof WRITE_METHODS)[number];

/**
 * Writes a read-only user may still perform: pay, authenticate, set the base currency that
 * onboarding requires before any other route is reachable, keep their notification inbox and
 * UI preferences usable, take their data, leave. Admin and test-fixture routes are exempt too.
 */
const READ_ONLY_ROUTES = new Set([
  'POST /user/currencies/base',
  'POST /user/data-export',
  'POST /notifications/read-all',
  'PUT /user/settings',
  'PATCH /user/settings',
  'DELETE /user/delete',
]);

const READ_ONLY_PREFIXES = ['/billing/', '/auth/', '/tests/', '/admin/'];

const NOTIFICATION_READ = /^\/notifications\/[^/]+\/read$/;

const isReadOnlyAllowed = ({ method, path }: { method: string; path: string }): boolean =>
  READ_ONLY_ROUTES.has(`${method} ${path}`) ||
  READ_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
  NOTIFICATION_READ.test(path);

const planRequired = ({ res, message }: { res: Response; message: string }) =>
  res.status(ERROR_CODES.PaymentRequired).json({
    status: API_RESPONSE_STATUS.error,
    response: { message, code: API_ERROR_CODES.planRequired },
  });

/** Resolved once per request; the gates, the read-only guard and the handlers share it. */
export const getRequestEntitlements = async ({ req }: { req: Request }): Promise<Entitlements> => {
  if (!req.entitlements) {
    req.entitlements = await resolveEntitlements({ user: req.user! });
  }
  return req.entitlements;
};

export const requireFeature =
  (feature: Feature) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { features } = await getRequestEntitlements({ req });
      if (!features.includes(feature)) {
        planRequired({ res, message: 'This feature is not included in your current plan.' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

/** A settings PATCH touching the `fire` slice needs the FIRE planner. */
export const requireFireSettingsAccess = (req: Request, res: Response, next: NextFunction) =>
  req.body?.fire === undefined ? next() : requireFeature(FEATURES.fire_planner)(req, res, next);

/** Whether the feature is covered by the plan, by a free try, or not at all. */
export const getRequestFeatureAccess = async ({
  req,
  feature,
}: {
  req: Request;
  feature: Feature;
}): Promise<FeatureAccess> => getFeatureAccess({ entitlements: await getRequestEntitlements({ req }), feature });

/** Same 402 as `requireFeature` once the free tries are spent. */
export const requireFeatureOrTrial =
  (feature: Feature) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if ((await getRequestFeatureAccess({ req, feature })) === 'denied') {
        planRequired({ res, message: 'This feature is not included in your current plan.' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

/** Runs inside `authenticateSession`: non-GET requests from a read-only user get 402. */
export const enforceReadOnly = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!WRITE_METHODS.includes(req.method as WriteMethod)) return next();

    const url = req.originalUrl.split('?')[0]!;
    const path = url.startsWith(API_PREFIX) ? url.slice(API_PREFIX.length) : url;
    if (isReadOnlyAllowed({ method: req.method, path })) return next();

    const { readOnly, subscriptions } = await getRequestEntitlements({ req });
    if (readOnly) {
      planRequired({
        res,
        message: subscriptions.length
          ? 'Your subscription has ended. Subscribe again to keep editing your data.'
          : 'Your trial has ended. Subscribe to keep editing your data.',
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
