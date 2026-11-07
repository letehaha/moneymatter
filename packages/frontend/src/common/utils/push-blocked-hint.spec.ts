import { getPushBlockedHintKey } from './push-blocked-hint';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  unknown: 'SomethingElse/1.0',
};

describe('getPushBlockedHintKey', () => {
  it.each([
    ['Chrome', UA.chromeMac, false, 'chrome'],
    ['Edge', UA.edgeWindows, false, 'edge'],
    ['Firefox', UA.firefoxLinux, false, 'firefox'],
    ['Safari on a Mac', UA.safariMac, false, 'safari'],
    ['an unknown agent', UA.unknown, false, 'other'],
  ])('maps %s to its own hint', (_name, userAgent, isIOS, expected) => {
    expect(getPushBlockedHintKey({ userAgent, isIOS })).toBe(expected);
  });

  it('gives iOS the system-settings hint whatever the browser string says', () => {
    expect(getPushBlockedHintKey({ userAgent: UA.safariIphone, isIOS: true })).toBe('ios');
    // iPadOS reports a Macintosh Safari agent
    expect(getPushBlockedHintKey({ userAgent: UA.safariMac, isIOS: true })).toBe('ios');
  });
});
