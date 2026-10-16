import { CliAiUnavailableReason } from '@bt/shared/types';
import { isSelfHost } from '@config/is-self-host';
import { t } from '@i18n/index';
import { NotAllowedError } from '@js/errors';
import { hasConfiguredAdmins, isAdminUsername } from '@middlewares/admin-only';
import { getUsernameById } from '@models/users.model';

export type CliAiAccess = { allowed: true; reason?: undefined } | { allowed: false; reason: CliAiUnavailableReason };

/**
 * Subscription CLI providers run vendor binaries under the backend's uid, so they are limited
 * to the instance admins of a self-hosted deployment.
 */
export async function getCliAiAccess({ userId }: { userId: number }): Promise<CliAiAccess> {
  if (!isSelfHost()) return { allowed: false, reason: 'not-self-host' };
  if (!hasConfiguredAdmins()) return { allowed: false, reason: 'admin-not-configured' };

  const username = await getUsernameById({ id: userId });

  return isAdminUsername({ username }) ? { allowed: true } : { allowed: false, reason: 'not-admin' };
}

export async function assertCliAiAllowed({ userId }: { userId: number }): Promise<void> {
  const access = await getCliAiAccess({ userId });

  if (!access.allowed) {
    throw new NotAllowedError({ message: t({ key: 'ai.cliProvidersNotAllowed' }) });
  }
}
