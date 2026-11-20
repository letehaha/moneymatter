/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolveLocale } from '@bt/shared/i18n/locales';
import { requestContext } from '@common/request-context';
import { NextFunction, Request, Response } from 'express';

import i18next from './index';

/**
 * Middleware to detect and set the user's language preference.
 * Uses Accept-Language header sent by frontend (which persists locale in localStorage).
 * Priority order:
 * 1. Query parameter (?lang=uk)
 * 2. Accept-Language header
 * 3. Default fallback (en)
 */
export async function detectLanguage(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const queryLang = typeof req.query.lang === 'string' ? req.query.lang : undefined;
    const locale = resolveLocale({ tag: queryLang || req.headers['accept-language'] });

    // Set locale on request for use in controllers/services
    (req as any).locale = locale;

    // Change i18next language for this request
    await i18next.changeLanguage(locale);

    // Wrap the rest of the request in AsyncLocalStorage context
    // This allows the locale to be accessed in async chains (e.g., better-auth hooks)
    requestContext.run({ locale }, () => {
      next();
    });
  } catch (error) {
    // If language detection fails, continue with default
    console.error('Error detecting language:', error);
    (req as any).locale = 'en';
    requestContext.run({ locale: 'en' }, () => {
      next();
    });
  }
}

/**
 * Add i18next instance to request for direct access
 */
export function addI18nextToRequest(req: Request, _res: Response, next: NextFunction): void {
  (req as any).i18n = i18next;
  next();
}
