import { IOS_APP_ORIGIN } from '@common/const/ios-app-origin';
import { errorHandler } from '@controllers/helpers';
import { t } from '@i18n/index';
import { ClientUpdateRequiredError } from '@js/errors';
import { logger } from '@js/utils/logger';
import type { NextFunction, Request, Response } from 'express';

// Capped so Number() stays exact; a longer value would lose precision or become Infinity.
const BUILD_NUMBER = /^\d{1,15}$/;

let invalidMinBuildLogged = false;

const parseBuild = ({ header }: { header: string | undefined }): number | 'dev' | null => {
  if (header === 'dev') return 'dev';
  if (!header || !BUILD_NUMBER.test(header)) return null;
  return Number(header);
};

/**
 * Answers 426 to iOS builds below `IOS_MIN_SUPPORTED_BUILD`.
 * Builds that send only `expo-origin` predate `x-app-build` and count as oldest (`null`).
 */
export const clientVersionGate = (req: Request, res: Response, next: NextFunction) => {
  const isIos = req.get('x-app-platform') === 'ios' || req.get('expo-origin') === IOS_APP_ORIGIN;
  if (!isIos) return next();

  const minBuild = process.env.IOS_MIN_SUPPORTED_BUILD?.trim();
  if (!minBuild) return next();

  if (!BUILD_NUMBER.test(minBuild)) {
    if (!invalidMinBuildLogged) {
      invalidMinBuildLogged = true;
      logger.error(`IOS_MIN_SUPPORTED_BUILD is not a build number ("${minBuild}"); no iOS build is blocked.`);
    }
    return next();
  }

  const build = parseBuild({ header: req.get('x-app-build') });
  if (build === 'dev') return next();

  if (build === null || build < Number(minBuild)) {
    return errorHandler(res, new ClientUpdateRequiredError({ message: t({ key: 'errors.clientUpdateRequired' }) }));
  }

  return next();
};
