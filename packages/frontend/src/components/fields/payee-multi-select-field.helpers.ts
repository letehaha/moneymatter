import { pickLogoFields } from '@/components/common/logo-selection';
import type { EntityLogoFields, RecordId } from '@bt/shared/types';
import { isEqual } from 'lodash-es';

export interface SelectedPayee extends EntityLogoFields {
  id: RecordId;
  name: string;
}

export interface PayeeLookupEntry extends EntityLogoFields {
  name: string;
}

/**
 * Refresh the display name/logo of each already-selected payee from a freshly
 * resolved lookup. Two lookups feed this: the search list the dropdown fetches
 * while open, and the by-id resolver that hydrates a saved view's selection
 * before the dropdown is ever opened (without it a restored single payee shows
 * its raw id until first open). Rows the lookup can't resolve — and rows whose
 * name and logo fields are unchanged — keep their existing object identity so Vue
 * skips needless re-renders.
 */
export const hydrateSelectedPayees = ({
  selected,
  lookup,
}: {
  selected: SelectedPayee[];
  lookup: Map<string, PayeeLookupEntry>;
}): SelectedPayee[] =>
  selected.map((sel) => {
    const fresh = lookup.get(sel.id);
    if (!fresh) return sel;
    const nextLogo = pickLogoFields(fresh);
    if (fresh.name === sel.name && isEqual(nextLogo, pickLogoFields(sel))) return sel;
    return { id: sel.id, name: fresh.name, ...nextLogo };
  });
