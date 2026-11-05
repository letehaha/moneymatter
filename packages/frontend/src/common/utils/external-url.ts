const protocolOf = (value: string) => {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
};

// Render guard for user-supplied links: only the API validates the scheme, and
// restored backups bypass it, so a `javascript:` value must never reach an href.
export const isHttpUrl = (value: string) => /^https?:$/i.test(protocolOf(value) ?? '');

export const isHttpsUrl = (value: string) => protocolOf(value) === 'https:';
