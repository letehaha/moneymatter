import { API_ERROR_CODES, DAY_TRIALABLE_FEATURES, UserInfoResponse } from '@bt/shared/types';
import { isoCurrencyCode } from '@common/lib/zod/custom-types';
import {
  deleteUserCurrencyBodySchema,
  editUserCurrencyBodySchema,
} from '@controllers/currencies/user-currency-body.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import { isAdminUsername } from '@middlewares/admin-only';
import { invalidateAppUserCache } from '@middlewares/better-auth';
import { ExchangeRatePair } from '@models/user-exchange-rates.model';
import { resolveEntitlements } from '@services/entitlements/resolve-entitlements.service';
import { startFeatureTrial as startFeatureTrialService } from '@services/entitlements/start-feature-trial.service';
import { getEmailForUser } from '@services/sharing/find-user-by-email.service';
import * as userExchangeRates from '@services/user-exchange-rate';
import { removeExchangeRatePairSchema } from '@services/user-exchange-rate/exchange-rate-pair-rules';
import * as userService from '@services/user.service';
import { deleteUser as deleteUserService } from '@services/user/delete-user.service';
import {
  getOwnedSharedResourceSummary,
  wipeUserData as wipeUserDataService,
} from '@services/user/wipe-user-data.service';
import { UniqueConstraintError } from 'sequelize';
import { z } from 'zod';

export const getUser = createController(z.object({}), async ({ user }) => {
  const userData = await userService.getUser(user.id);
  if (!userData) throw new NotFoundError({ message: 'User not found.' });

  const [email, entitlements] = await Promise.all([
    getEmailForUser({ userId: user.id }),
    resolveEntitlements({ user: userData }),
  ]);

  return {
    data: {
      ...userData,
      email,
      entitlements,
      isAdmin: isAdminUsername({ username: user.username }),
    } satisfies UserInfoResponse,
  };
});

export const startFeatureTrial = createController(
  z.object({
    params: z.object({ feature: z.enum(DAY_TRIALABLE_FEATURES) }),
  }),
  async ({ user, params }) => ({
    data: await startFeatureTrialService({ userId: user.id, feature: params.feature }),
  }),
);

export const updateUser = createController(
  z.object({
    body: z.object({
      // Mirrors slugifyUsername output: lowercase ASCII alphanumerics with single
      // hyphens between alphanumeric runs. 1-64 chars matches the signup-side cap.
      username: z
        .string()
        .trim()
        .min(1, 'Username must not be empty')
        .max(64, 'Username must be 64 characters or fewer')
        .regex(
          /^[a-z0-9]+(-[a-z0-9]+)*$/,
          'Username must contain only lowercase letters, digits, and single hyphens (no leading, trailing, or consecutive hyphens)',
        )
        .optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      middleName: z.string().optional(),
      avatar: z.string().optional(),
      totalBalance: z.number().optional(),
    }),
  }),
  async ({ user, body }) => {
    // adminOnly gates its endpoints on username, so renaming into ADMIN_USERS would be
    // privilege escalation. A no-op rename to the user's own current name is fine.
    if (body.username && body.username !== user.username && isAdminUsername({ username: body.username })) {
      throw new ValidationError({
        message: 'This username is reserved and cannot be used.',
      });
    }

    try {
      const userData = await userService.updateUser({
        id: user.id,
        ...body,
      });

      // Invalidate cached user so the next request picks up the new username/role
      await invalidateAppUserCache({ authUserId: user.authUserId });

      return { data: userData };
    } catch (error) {
      // Surface a 422 instead of a 500 when the new username collides with
      // another user's. Without this, the raw UniqueConstraintError bubbles
      // up as an unexpected error.
      if (error instanceof UniqueConstraintError && error.errors?.some((e) => e.path === 'username') && body.username) {
        throw new ValidationError({
          message: t({ key: 'users.usernameAlreadyTaken', variables: { username: body.username } }),
        });
      }
      throw error;
    }
  },
);

export const deleteUser = createController(z.object({}), async ({ user }) => {
  await deleteUserService({ userId: user.id });
});

export const wipeUserData = createController(
  z.object({
    body: z.object({
      acknowledgeSharing: z.boolean().optional(),
    }),
  }),
  async ({ user, body }) => {
    if (!body.acknowledgeSharing) {
      const summary = await getOwnedSharedResourceSummary({ userId: user.id });
      if (summary.accounts.length > 0 || summary.households.length > 0) {
        throw new ConflictError({
          code: API_ERROR_CODES.wipeDataSharingAcknowledgementRequired,
          message: 'Wiping your data will revoke access for other users currently sharing your resources.',
          details: { sharedResources: summary },
        });
      }
    }

    await wipeUserDataService({ userId: user.id });
  },
);

export const getUserCurrencies = createController(z.object({}), async ({ user }) => {
  const result = await userService.getUserCurrencies({
    userId: user.id,
  });
  return { data: result };
});

export const getUserBaseCurrency = createController(z.object({}), async ({ user }) => {
  const result = await userService.getUserBaseCurrency({
    userId: user.id,
  });
  return { data: result };
});

export const setBaseUserCurrency = createController(
  z.object({
    body: z.object({
      currencyCode: isoCurrencyCode(),
    }),
  }),
  async ({ user, body }) => {
    const result = await userService.setBaseUserCurrency({
      userId: user.id,
      currencyCode: body.currencyCode,
    });
    return { data: result };
  },
);

export const editUserCurrency = createController(
  z.object({
    body: editUserCurrencyBodySchema,
  }),
  async ({ user, body }) => {
    const result = await userService.editUserCurrency({
      userId: user.id,
      currencyCode: body.currencyCode,
      exchangeRate: body.exchangeRate,
      liveRateUpdate: body.liveRateUpdate,
    });
    return { data: result };
  },
);

export const deleteUserCurrency = createController(
  z.object({
    body: deleteUserCurrencyBodySchema,
  }),
  async ({ user, body }) => {
    await userService.deleteUserCurrency({
      userId: user.id,
      currencyCode: body.currencyCode,
    });
  },
);

export const getCurrenciesExchangeRates = createController(z.object({}), async ({ user }) => {
  const data = await userExchangeRates.getUserExchangeRates({ userId: user.id });
  return { data };
});

export const removeUserCurrencyExchangeRate = createController(
  z.object({
    body: z.object({
      pairs: z.array(removeExchangeRatePairSchema),
    }),
  }),
  async ({ user, body }) => {
    const { pairs } = body;

    const data = await userExchangeRates.removeUserExchangeRates({
      userId: user.id,
      pairs: pairs as ExchangeRatePair[],
    });

    return { data };
  },
);
