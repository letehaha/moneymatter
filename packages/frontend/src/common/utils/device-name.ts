const BROWSERS: [RegExp, string][] = [
  [/edg(e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/firefox|fxios/i, 'Firefox'],
  [/chrome|crios/i, 'Chrome'],
  [/safari/i, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  [/iphone|ipod/i, 'iPhone'],
  [/ipad/i, 'iPad'],
  [/android/i, 'Android'],
  [/windows/i, 'Windows'],
  [/mac os|macintosh/i, 'Mac'],
  [/cros/i, 'ChromeOS'],
  [/linux/i, 'Linux'],
];

const match = (table: [RegExp, string][], ua: string) => table.find(([re]) => re.test(ua))?.[1];

// ponytail: UA sniffing, good enough for a default label the user can rename.
export function getDeviceName({
  userAgent = navigator.userAgent,
  fallback = 'Passkey',
}: { userAgent?: string; fallback?: string } = {}): string {
  const browser = match(BROWSERS, userAgent);
  const platform = match(PLATFORMS, userAgent);
  if (browser && platform) return `${browser} on ${platform}`;
  return browser || platform || fallback;
}
