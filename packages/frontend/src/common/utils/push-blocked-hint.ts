type PushBlockedHintKey = 'chrome' | 'edge' | 'firefox' | 'safari' | 'ios' | 'other';

// Order matters: Edge and Chrome both carry "Chrome", Chrome and Safari both carry "Safari".
const BROWSER_HINTS: [RegExp, PushBlockedHintKey][] = [
  [/edg(e|a|ios)?\//i, 'edge'],
  [/opr\/|opera/i, 'other'],
  [/firefox|fxios/i, 'firefox'],
  [/chrome|crios/i, 'chrome'],
  [/safari/i, 'safari'],
];

/**
 * Which "notifications are blocked" instructions to show. Where to unblock a site differs per
 * browser, and iOS has no per-site switch: it is the app's entry in system Settings.
 */
export const getPushBlockedHintKey = ({
  userAgent,
  isIOS,
}: {
  userAgent: string;
  isIOS: boolean;
}): PushBlockedHintKey => {
  if (isIOS) return 'ios';

  return BROWSER_HINTS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'other';
};
