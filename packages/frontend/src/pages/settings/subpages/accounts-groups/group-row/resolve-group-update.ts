import { type LogoSelection, toLogoPatch } from '@/components/common/logo-selection';
import type { EntityLogoPayload } from '@bt/shared/types';

import type { RenameResolution } from './resolve-rename';

type GroupUpdatePayload = { name?: string } & EntityLogoPayload;

interface GroupUpdatePlan {
  /** The payload to submit, or null when there is nothing to save. */
  updates: GroupUpdatePayload | null;
  /** Set when the draft can't be saved at all, so the form can explain the disabled submit. */
  blockedBy: 'empty-name' | null;
}

/**
 * Builds the single update the form submits. An untouched picker contributes no logo keys,
 * while clearing the logo sends explicit nulls — absent keys leave the stored logo alone.
 */
export const resolveGroupUpdate = ({
  rename,
  logo,
  storedLogo,
}: {
  rename: RenameResolution;
  logo: LogoSelection | null;
  storedLogo: LogoSelection | null;
}): GroupUpdatePlan => {
  if (rename.outcome === 'empty') {
    return { updates: null, blockedBy: 'empty-name' };
  }

  const updates: GroupUpdatePayload = {
    ...(rename.outcome === 'submit' ? { name: rename.name } : {}),
    ...toLogoPatch({ selection: logo, stored: storedLogo }),
  };

  return {
    updates: Object.keys(updates).length > 0 ? updates : null,
    blockedBy: null,
  };
};
