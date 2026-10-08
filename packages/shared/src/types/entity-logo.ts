/**
 * How an entity's logoDomain was resolved, on the write-only paths that always
 * set a concrete source. 'auto' = matched by the brand resolver against
 * BrandLogos; 'manual' = explicitly set by the user. Shared by every entity that
 * carries a denormalized brand logo (payees, subscriptions). VARCHAR column – no
 * DB enum (project convention).
 */
export type LogoSource = 'auto' | 'manual';

/**
 * Persisted three-state of an entity's logo resolution:
 * - `'auto'`: the brand resolver matched (or negative-resolved) this entity.
 * - `'manual'`: the user set the logo explicitly; the resolver treats it as authoritative.
 * - `null`: unresolved – the entity has never been through a resolution pass.
 *
 * This is the column type. `LogoSource` is the narrower write-only type for code
 * paths that always stamp a concrete source.
 */
export type LogoResolutionState = LogoSource | null;

/**
 * Denormalized logo config shared by every logo-bearing entity (payees,
 * subscriptions, accounts, account groups). A brand domain and custom monogram
 * letters are mutually exclusive – every write path evicts one when the other
 * is set.
 */
export interface EntityLogoFields {
  /** Resolved brand domain used to fetch the logo (e.g. "netflix.com"). Null
   *  when no logo is set, or when the brand resolver has not matched the
   *  entity. */
  logoDomain: string | null;
  /** 1-2 graphemes rendered as a monogram in place of a brand image. Mutually
   *  exclusive with logoDomain. Null when no custom monogram is set. */
  logoInitials: string | null;
  /** '#rrggbb' lowercase background for logoInitials. Null renders the initials
   *  on the app's default monogram color. */
  logoColor: string | null;
}

/** Write-path shape of the logo fields: absent key = leave the stored column
 *  untouched, null = clear it. */
export type EntityLogoPayload = Partial<EntityLogoFields>;

/** Logo columns a write path may set on an entity a background resolver also
 *  writes (payees, subscriptions): the payload keys plus the ownership stamp
 *  that keeps the resolver off a user-picked logo. */
export interface ManualLogoWrite extends EntityLogoPayload {
  logoSource?: Extract<LogoResolutionState, 'manual'>;
}
