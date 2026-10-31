/**
 * Controllers that wrap better-auth server-side only APIs.
 */
import { AuthFeaturesResponse } from '@bt/shared/types';
import { auth } from '@config/auth';
import { oidcConfig } from '@config/oidc';
import { createController } from '@controllers/helpers/controller-factory';
import { isEmailEnabled } from '@services/email';
import { areSignupsOpen } from '@services/user/signups-open.service';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';

export const signupsOpen = createController(z.object({}), async () => {
  return { data: { signupsOpen: await areSignupsOpen() } };
});

export const authFeatures = createController(z.object({}), async () => {
  const data: AuthFeaturesResponse = {
    emailEnabled: isEmailEnabled,
    oidc: oidcConfig ? { name: oidcConfig.displayName } : null,
  };
  return { data };
});

/**
 * Set password for OAuth-only users.
 * Wraps auth.api.setPassword() which is server-side only in better-auth.
 */
export const setPassword = createController(
  z.object({
    body: z.object({
      newPassword: z.string().min(8),
    }),
  }),
  async ({ body, req }) => {
    const result = await auth.api.setPassword({
      body,
      headers: fromNodeHeaders(req.headers),
    });

    return { data: result };
  },
);
