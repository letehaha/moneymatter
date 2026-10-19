import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MONOGRAM_COLOR,
  type LogoSelection,
  logoSelectionKey,
  pickLogoFields,
  toLogoDisplayProps,
  toLogoPatch,
  toLogoPayload,
  toLogoSelection,
  toOptionalLogoPayload,
} from './logo-selection';

describe('toLogoSelection', () => {
  it('returns null when neither a domain nor initials are stored', () => {
    expect(toLogoSelection({ logoDomain: null, logoInitials: null, logoColor: null })).toBe(null);
    expect(toLogoSelection({})).toBe(null);
  });

  it('builds a brand selection from a stored domain', () => {
    expect(toLogoSelection({ logoDomain: 'netflix.com', logoInitials: null, logoColor: null })).toEqual({
      kind: 'brand',
      domain: 'netflix.com',
    });
  });

  it('builds a monogram selection from stored initials', () => {
    expect(toLogoSelection({ logoDomain: null, logoInitials: 'NF', logoColor: '#112233' })).toEqual({
      kind: 'monogram',
      initials: 'NF',
      color: '#112233',
    });
  });

  it('falls back to the default color for a monogram stored without one', () => {
    expect(toLogoSelection({ logoDomain: null, logoInitials: 'NF', logoColor: null })).toEqual({
      kind: 'monogram',
      initials: 'NF',
      color: DEFAULT_MONOGRAM_COLOR,
    });
  });

  it('builds an icon selection from a stored icon', () => {
    expect(toLogoSelection({ logoIcon: 'airplane-20-filled', logoColor: '#112233' })).toEqual({
      kind: 'icon',
      icon: 'airplane-20-filled',
      color: '#112233',
    });
  });

  it('falls back to the default color for an icon stored without one', () => {
    expect(toLogoSelection({ logoIcon: 'airplane-20-filled', logoColor: null })).toEqual({
      kind: 'icon',
      icon: 'airplane-20-filled',
      color: DEFAULT_MONOGRAM_COLOR,
    });
  });

  it('builds an image selection from a stored image id', () => {
    expect(toLogoSelection({ logoImageId: 'img-1', logoDomain: null, logoInitials: null })).toEqual({
      kind: 'image',
      imageId: 'img-1',
    });
  });

  it('prefers initials over a domain when both are stored', () => {
    expect(toLogoSelection({ logoDomain: 'netflix.com', logoInitials: 'NF', logoColor: '#112233' })).toEqual({
      kind: 'monogram',
      initials: 'NF',
      color: '#112233',
    });
  });
});

describe('toLogoPayload', () => {
  it('clears the domain and the monogram when nothing is selected', () => {
    expect(toLogoPayload({ selection: null })).toEqual({ logoDomain: null, logoInitials: null, logoIcon: null });
  });

  it('sends only the domain for a brand selection', () => {
    expect(toLogoPayload({ selection: { kind: 'brand', domain: 'netflix.com' } })).toEqual({
      logoDomain: 'netflix.com',
    });
  });

  it('sends initials with their color for a monogram selection', () => {
    expect(toLogoPayload({ selection: { kind: 'monogram', initials: 'NF', color: '#112233' } })).toEqual({
      logoInitials: 'NF',
      logoColor: '#112233',
    });
  });

  it('sends the icon with its color for an icon selection', () => {
    expect(toLogoPayload({ selection: { kind: 'icon', icon: 'airplane-20-filled', color: '#112233' } })).toEqual({
      logoIcon: 'airplane-20-filled',
      logoColor: '#112233',
    });
  });

  it('sends the data URL for a freshly cropped image', () => {
    expect(toLogoPayload({ selection: { kind: 'image-upload', dataUrl: 'data:image/webp;base64,AAA' } })).toEqual({
      logoImage: 'data:image/webp;base64,AAA',
    });
  });

  it('contributes no keys for an already stored image', () => {
    expect(toLogoPayload({ selection: { kind: 'image', imageId: 'img-1' } })).toEqual({});
  });
});

describe('toOptionalLogoPayload', () => {
  it('contributes no keys when nothing is selected', () => {
    expect(toOptionalLogoPayload({ selection: null })).toEqual({});
    expect(Object.keys(toOptionalLogoPayload({ selection: null }))).toEqual([]);
  });

  it('contributes no keys when the selection is undefined', () => {
    expect(Object.keys(toOptionalLogoPayload({ selection: undefined }))).toEqual([]);
  });

  it('matches toLogoPayload for a brand selection', () => {
    const selection: LogoSelection = { kind: 'brand', domain: 'netflix.com' };
    expect(toOptionalLogoPayload({ selection })).toEqual(toLogoPayload({ selection }));
  });

  it('matches toLogoPayload for a monogram selection', () => {
    const selection: LogoSelection = { kind: 'monogram', initials: 'NF', color: '#112233' };
    expect(toOptionalLogoPayload({ selection })).toEqual(toLogoPayload({ selection }));
  });
});

describe('logoSelectionKey', () => {
  it('gives structurally equal selections the same key', () => {
    expect(logoSelectionKey({ selection: { kind: 'brand', domain: 'netflix.com' } })).toBe(
      logoSelectionKey({ selection: { kind: 'brand', domain: 'netflix.com' } }),
    );
    expect(logoSelectionKey({ selection: { kind: 'monogram', initials: 'NF', color: '#112233' } })).toBe(
      logoSelectionKey({ selection: { kind: 'monogram', initials: 'NF', color: '#112233' } }),
    );
  });

  it('gives distinct selections distinct keys', () => {
    const keys = [
      logoSelectionKey({ selection: null }),
      logoSelectionKey({ selection: { kind: 'brand', domain: 'netflix.com' } }),
      logoSelectionKey({ selection: { kind: 'brand', domain: 'spotify.com' } }),
      logoSelectionKey({ selection: { kind: 'monogram', initials: 'NF', color: '#112233' } }),
      logoSelectionKey({ selection: { kind: 'monogram', initials: 'SP', color: '#112233' } }),
      logoSelectionKey({ selection: { kind: 'monogram', initials: 'NF', color: '#445566' } }),
      logoSelectionKey({ selection: { kind: 'icon', icon: 'airplane-20-filled', color: '#112233' } }),
      logoSelectionKey({ selection: { kind: 'icon', icon: 'airplane-20-filled', color: '#445566' } }),
      logoSelectionKey({ selection: { kind: 'image', imageId: 'img-1' } }),
      logoSelectionKey({ selection: { kind: 'image', imageId: 'img-2' } }),
      logoSelectionKey({ selection: { kind: 'image-upload', dataUrl: 'data:image/webp;base64,AAA' } }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not collide between a brand and a monogram carrying the same text', () => {
    expect(logoSelectionKey({ selection: { kind: 'brand', domain: 'nf' } })).not.toBe(
      logoSelectionKey({ selection: { kind: 'monogram', initials: 'nf', color: DEFAULT_MONOGRAM_COLOR } }),
    );
  });

  it('round-trips a stored logo to the same key regardless of the object rebuilt around it', () => {
    const stored = { logoDomain: null, logoInitials: 'NF', logoColor: '#112233' };
    expect(logoSelectionKey({ selection: toLogoSelection(stored) })).toBe(
      logoSelectionKey({ selection: toLogoSelection({ ...stored }) }),
    );
  });
});

describe('toLogoPatch', () => {
  it('contributes no keys when the selection matches the stored logo', () => {
    expect(
      toLogoPatch({
        selection: { kind: 'brand', domain: 'netflix.com' },
        stored: { kind: 'brand', domain: 'netflix.com' },
      }),
    ).toEqual({});
    expect(toLogoPatch({ selection: null, stored: null })).toEqual({});
  });

  it('sends the new domain when the brand changed', () => {
    expect(
      toLogoPatch({
        selection: { kind: 'brand', domain: 'spotify.com' },
        stored: { kind: 'brand', domain: 'netflix.com' },
      }),
    ).toEqual({ logoDomain: 'spotify.com' });
  });

  it('sends three nulls without logoImage when a stored brand or monogram is cleared', () => {
    const cleared = { logoDomain: null, logoInitials: null, logoIcon: null };
    expect(toLogoPatch({ selection: null, stored: { kind: 'brand', domain: 'netflix.com' } })).toEqual(cleared);
    expect(toLogoPatch({ selection: null, stored: { kind: 'monogram', initials: 'NF', color: '#112233' } })).toEqual(
      cleared,
    );
  });

  it('sends the three nulls plus logoImage: null when a stored image is cleared', () => {
    expect(toLogoPatch({ selection: null, stored: { kind: 'image', imageId: 'img-1' } })).toEqual({
      logoDomain: null,
      logoInitials: null,
      logoIcon: null,
      logoImage: null,
    });
  });

  it('contributes no keys when the stored image is untouched', () => {
    expect(
      toLogoPatch({ selection: { kind: 'image', imageId: 'img-1' }, stored: { kind: 'image', imageId: 'img-1' } }),
    ).toEqual({});
  });

  it('sends no logoImage key when a stored image switches to an icon or monogram', () => {
    const stored: LogoSelection = { kind: 'image', imageId: 'img-1' };
    const toIcon = toLogoPatch({ selection: { kind: 'icon', icon: 'airplane-20-filled', color: '#112233' }, stored });
    const toMonogram = toLogoPatch({ selection: { kind: 'monogram', initials: 'NF', color: '#112233' }, stored });
    expect(toIcon).toEqual({ logoIcon: 'airplane-20-filled', logoColor: '#112233' });
    expect(toMonogram).toEqual({ logoInitials: 'NF', logoColor: '#112233' });
    expect('logoImage' in toIcon).toBe(false);
    expect('logoImage' in toMonogram).toBe(false);
  });

  it('sends the new image when it replaces the stored one', () => {
    expect(
      toLogoPatch({
        selection: { kind: 'image-upload', dataUrl: 'data:image/webp;base64,AAA' },
        stored: { kind: 'image', imageId: 'img-1' },
      }),
    ).toEqual({ logoImage: 'data:image/webp;base64,AAA' });
  });
});

describe('toLogoDisplayProps', () => {
  const EMPTY_DISPLAY = { domain: null, initials: null, icon: null, color: null, imageId: null, imageDataUrl: null };

  it('nulls every prop when nothing is selected', () => {
    expect(toLogoDisplayProps({ selection: null })).toEqual(EMPTY_DISPLAY);
  });

  it('exposes only the domain for a brand selection', () => {
    expect(toLogoDisplayProps({ selection: { kind: 'brand', domain: 'netflix.com' } })).toEqual({
      ...EMPTY_DISPLAY,
      domain: 'netflix.com',
    });
  });

  it('exposes initials with their color for a monogram selection', () => {
    expect(toLogoDisplayProps({ selection: { kind: 'monogram', initials: 'NF', color: '#112233' } })).toEqual({
      ...EMPTY_DISPLAY,
      initials: 'NF',
      color: '#112233',
    });
  });

  it('exposes the icon with its color for an icon selection', () => {
    expect(toLogoDisplayProps({ selection: { kind: 'icon', icon: 'airplane-20-filled', color: '#112233' } })).toEqual({
      ...EMPTY_DISPLAY,
      icon: 'airplane-20-filled',
      color: '#112233',
    });
  });

  it('exposes the image id for a stored image and the data URL for a new one', () => {
    expect(toLogoDisplayProps({ selection: { kind: 'image', imageId: 'img-1' } })).toEqual({
      ...EMPTY_DISPLAY,
      imageId: 'img-1',
    });
    expect(toLogoDisplayProps({ selection: { kind: 'image-upload', dataUrl: 'data:image/webp;base64,AAA' } })).toEqual({
      ...EMPTY_DISPLAY,
      imageDataUrl: 'data:image/webp;base64,AAA',
    });
  });
});

describe('pickLogoFields', () => {
  it('keeps only the logo fields and fills absent ones with null', () => {
    const payee = { name: 'Netflix', logoDomain: 'netflix.com' };
    expect(pickLogoFields(payee)).toEqual({
      logoDomain: 'netflix.com',
      logoInitials: null,
      logoColor: null,
      logoIcon: null,
      logoImageId: null,
    });
  });
});
