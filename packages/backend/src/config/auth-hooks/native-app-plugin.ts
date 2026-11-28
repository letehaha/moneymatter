import { OAUTH_PROVIDER } from '@bt/shared/types';
import { isSelfHost } from '@config/is-self-host';
import { APPLE_NONCE_ERROR, checkAppleNonce, stampServerOnAppRedirect } from '@config/native-app-auth';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import { APIError, type BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';

// The only two routes that accept a client-supplied ID token.
const ID_TOKEN_PATHS = ['/sign-in/social', '/link-social'];

export const nativeAppPlugin = ({
  authority,
  appleWebFlowEnabled,
}: {
  authority: string;
  appleWebFlowEnabled: boolean;
}) =>
  ({
    id: 'native-app',
    hooks: {
      before: [
        {
          matcher: (ctx) => ID_TOKEN_PATHS.includes(ctx.path ?? ''),
          // Runs ahead of schema validation, so every body field is untyped here.
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { provider?: unknown; idToken?: unknown } | undefined;
            if (body?.provider !== OAUTH_PROVIDER.apple) return;

            if (body.idToken == null) {
              // Without a client secret the redirect flow throws a 500 inside better-auth; answer as a disabled provider.
              if (appleWebFlowEnabled) return;
              throw new APIError('NOT_FOUND', { message: 'Provider not found', code: 'PROVIDER_NOT_FOUND' });
            }

            const error = checkAppleNonce({ idToken: body.idToken, selfHost: isSelfHost(), authority });
            if (!error) return;
            // Never log the token or the random part of the nonce: together they replay a sign-in.
            const nonce = (body.idToken as { nonce?: unknown }).nonce;
            logger.warn('Apple ID token nonce rejected', {
              code: error,
              expectedAuthority: authority,
              receivedAuthority: typeof nonce === 'string' && nonce.includes('|') ? nonce.split('|')[0] : null,
            });
            throw new APIError('FORBIDDEN', {
              code: error,
              message: t({
                key:
                  error === APPLE_NONCE_ERROR.serverMismatch
                    ? 'auth.errors.appleNonceServerMismatch'
                    : 'auth.errors.appleNonceInvalid',
              }),
            });
          }),
        },
      ],
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const location = ctx.context.responseHeaders?.get('location');
            if (!location) return;
            const stamped = stampServerOnAppRedirect({
              location,
              authority,
              isTrustedOrigin: (url) => ctx.context.isTrustedOrigin(url),
            });
            if (stamped) ctx.setHeader('location', stamped);
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
