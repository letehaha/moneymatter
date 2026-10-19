import { EntityLogoPayload, ManualLogoWrite } from '@bt/shared/types';

import { applyManualLogoPatch, LOGO_FIELD_KEYS } from './apply-manual-logo-patch';

/**
 * The logo columns to write for an entity a background resolver also writes.
 * On top of the eviction rules, a write that changes a stored value marks the
 * logo user-owned (`logoSource: 'manual'`) so the resolver leaves it alone,
 * while a patch whose writes all equal the stored values returns `{}` – a no-op
 * (e.g. clearing an already-empty field) must not claim ownership, otherwise the
 * background resolver could never fill that logo in later.
 */
export const resolveManualLogoFields = ({
  input,
  stored = {},
}: {
  input: EntityLogoPayload;
  stored?: EntityLogoPayload;
}): ManualLogoWrite => {
  const patch = applyManualLogoPatch({ patch: input, stored });

  const changesStoredValue = LOGO_FIELD_KEYS.some((key) => key in patch && patch[key] !== (stored[key] ?? null));
  if (!changesStoredValue) {
    return {};
  }

  return { logoSource: 'manual', ...patch };
};
