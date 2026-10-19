import type { EntityLogoFields, EntityLogoPayload, EntityLogoWritePayload } from '@bt/shared/types';

/**
 * What the logo picker hands back: a brand domain resolved through logo.dev, a
 * letter monogram or an icon on a color fill, a stored image, or a freshly
 * cropped image not uploaded yet.
 */
export type LogoSelection =
  | { kind: 'brand'; domain: string }
  | { kind: 'monogram'; initials: string; color: string }
  | { kind: 'icon'; icon: string; color: string }
  | { kind: 'image'; imageId: string }
  | { kind: 'image-upload'; dataUrl: string };

export type LogoTab = 'brand' | 'letters' | 'icon' | 'custom';

export const ALL_LOGO_TABS: LogoTab[] = ['brand', 'letters', 'icon', 'custom'];

/** Non-tracker endpoints drop `logoImage`, so the custom tab is opt-in. */
export const DEFAULT_LOGO_TABS: LogoTab[] = ['brand', 'letters'];

/** Default swatch of the Letters tab – the app's primary violet. */
export const DEFAULT_MONOGRAM_COLOR = '#7355be';

/**
 * Builds a selection from an entity's stored logo fields. Null means nothing
 * was set manually, so the backend auto-resolves. A monogram or icon stored
 * without a color opens the picker on the default swatch.
 */
export const toLogoSelection = ({
  logoDomain,
  logoInitials,
  logoColor,
  logoIcon,
  logoImageId,
}: EntityLogoPayload): LogoSelection | null => {
  if (logoImageId) return { kind: 'image', imageId: logoImageId };
  if (logoIcon) return { kind: 'icon', icon: logoIcon, color: logoColor ?? DEFAULT_MONOGRAM_COLOR };
  if (logoInitials) return { kind: 'monogram', initials: logoInitials, color: logoColor ?? DEFAULT_MONOGRAM_COLOR };
  if (logoDomain) return { kind: 'brand', domain: logoDomain };
  return null;
};

/**
 * Maps a selection onto mutation fields. Null clears the domain, initials and
 * icon columns – the stored color goes with them. Clearing an image needs
 * `logoImage: null`, which only tracker endpoints accept, so `toLogoPatch` adds
 * it. A stored image contributes nothing because it is already on the server.
 */
export const toLogoPayload = ({ selection }: { selection: LogoSelection | null }): EntityLogoWritePayload => {
  if (!selection) return { logoDomain: null, logoInitials: null, logoIcon: null };
  switch (selection.kind) {
    case 'brand':
      return { logoDomain: selection.domain };
    case 'monogram':
      return { logoInitials: selection.initials, logoColor: selection.color };
    case 'icon':
      return { logoIcon: selection.icon, logoColor: selection.color };
    case 'image':
      return {};
    case 'image-upload':
      return { logoImage: selection.dataUrl };
  }
};

/**
 * Maps a selection onto mutation fields, contributing no keys when nothing was
 * picked. Present-null keys stamp logoSource 'manual', so an untouched picker
 * has to stay out of the payload entirely rather than send explicit nulls.
 */
export const toOptionalLogoPayload = ({
  selection,
}: {
  selection: LogoSelection | null | undefined;
}): EntityLogoWritePayload => (selection ? toLogoPayload({ selection }) : {});

/**
 * Structural identity of a selection. Refetches rebuild the entity object, so
 * comparing selections by reference would report spurious changes.
 */
export const logoSelectionKey = ({ selection }: { selection: LogoSelection | null }): string => {
  if (!selection) return 'none';
  switch (selection.kind) {
    case 'brand':
      return `brand:${selection.domain}`;
    case 'monogram':
      return `monogram:${selection.initials}:${selection.color}`;
    case 'icon':
      return `icon:${selection.icon}:${selection.color}`;
    case 'image':
      return `image:${selection.imageId}`;
    case 'image-upload':
      return `image-upload:${selection.dataUrl}`;
  }
};

/**
 * Logo fields for an update: no keys when the selection matches the stored
 * logo, so an untouched picker leaves the stored columns alone. Clearing a
 * stored image also sends `logoImage: null`.
 */
export const toLogoPatch = ({
  selection,
  stored,
}: {
  selection: LogoSelection | null;
  stored: LogoSelection | null;
}): EntityLogoWritePayload => {
  if (logoSelectionKey({ selection }) === logoSelectionKey({ selection: stored })) return {};
  const payload = toLogoPayload({ selection });
  return !selection && stored?.kind === 'image' ? { ...payload, logoImage: null } : payload;
};

/** Splits a selection into the props BrandLogo renders. */
export const toLogoDisplayProps = ({ selection }: { selection: LogoSelection | null }) => ({
  domain: selection?.kind === 'brand' ? selection.domain : null,
  initials: selection?.kind === 'monogram' ? selection.initials : null,
  icon: selection?.kind === 'icon' ? selection.icon : null,
  color: selection?.kind === 'monogram' || selection?.kind === 'icon' ? selection.color : null,
  imageId: selection?.kind === 'image' ? selection.imageId : null,
  imageDataUrl: selection?.kind === 'image-upload' ? selection.dataUrl : null,
});

/** BrandLogo props for an entity's stored logo fields. */
export const toEntityLogoDisplayProps = (entity: EntityLogoPayload) =>
  toLogoDisplayProps({ selection: toLogoSelection(entity) });

export const pickLogoFields = (source: EntityLogoPayload): EntityLogoFields => ({
  logoDomain: source.logoDomain ?? null,
  logoInitials: source.logoInitials ?? null,
  logoColor: source.logoColor ?? null,
  logoIcon: source.logoIcon ?? null,
  logoImageId: source.logoImageId ?? null,
});
