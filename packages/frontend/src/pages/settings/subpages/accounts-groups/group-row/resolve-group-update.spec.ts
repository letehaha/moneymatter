import type { LogoSelection } from '@/components/common/logo-selection';
import { describe, expect, it } from 'vitest';

import { resolveGroupUpdate } from './resolve-group-update';
import { resolveRename } from './resolve-rename';

const brand: LogoSelection = { kind: 'brand', domain: 'revolut.com' };
const monogram: LogoSelection = { kind: 'monogram', initials: 'SV', color: '#7355be' };

const plan = ({
  draftName,
  currentName,
  logo = null,
  storedLogo = null,
}: {
  draftName: string;
  currentName: string;
  logo?: LogoSelection | null;
  storedLogo?: LogoSelection | null;
}) => resolveGroupUpdate({ rename: resolveRename({ draftName, currentName }), logo, storedLogo });

describe('resolveGroupUpdate', () => {
  it('submits nothing when neither the name nor the logo changed', () => {
    expect(plan({ draftName: 'Cash', currentName: 'Cash', logo: brand, storedLogo: brand })).toEqual({
      updates: null,
      blockedBy: null,
    });
  });

  it('sends the trimmed name without any logo keys when only the name changed', () => {
    expect(plan({ draftName: '  Savings ', currentName: 'Cash', logo: brand, storedLogo: brand }).updates).toEqual({
      name: 'Savings',
    });
  });

  it('submits a logo-only change while the name stays untouched', () => {
    const result = plan({ draftName: 'Cash', currentName: 'Cash', logo: brand, storedLogo: null });

    expect(result.updates).toEqual({ logoDomain: 'revolut.com' });
    expect(result.blockedBy).toBeNull();
  });

  it('sends the monogram fields when a letter logo is picked', () => {
    expect(plan({ draftName: 'Cash', currentName: 'Cash', logo: monogram, storedLogo: brand }).updates).toEqual({
      logoInitials: 'SV',
      logoColor: '#7355be',
    });
  });

  it('sends explicit nulls when a stored logo is cleared', () => {
    expect(plan({ draftName: 'Cash', currentName: 'Cash', logo: null, storedLogo: brand }).updates).toEqual({
      logoDomain: null,
      logoInitials: null,
      logoIcon: null,
    });
  });

  it('carries the name and the cleared logo in one payload', () => {
    expect(plan({ draftName: 'Savings', currentName: 'Cash', logo: null, storedLogo: monogram }).updates).toEqual({
      name: 'Savings',
      logoDomain: null,
      logoInitials: null,
      logoIcon: null,
    });
  });

  it('carries the name and a replacement logo in one payload', () => {
    expect(plan({ draftName: 'Savings', currentName: 'Cash', logo: brand, storedLogo: monogram }).updates).toEqual({
      name: 'Savings',
      logoDomain: 'revolut.com',
    });
  });

  it('blocks a blank name even when the logo changed, and says why', () => {
    expect(plan({ draftName: '   ', currentName: 'Cash', logo: brand, storedLogo: null })).toEqual({
      updates: null,
      blockedBy: 'empty-name',
    });
  });

  it('keeps the name out of the payload when only padding was edited', () => {
    expect(plan({ draftName: '  Cash  ', currentName: 'Cash', logo: brand, storedLogo: null }).updates).toEqual({
      logoDomain: 'revolut.com',
    });
  });

  it('omits logo keys when the picker was never touched on a group without a logo', () => {
    expect(plan({ draftName: 'Savings', currentName: 'Cash', logo: null, storedLogo: null }).updates).toEqual({
      name: 'Savings',
    });
  });
});
