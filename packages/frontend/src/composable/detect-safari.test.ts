import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSafariDetection } from './detect-safari';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const stubNavigator = ({ userAgent, maxTouchPoints = 0 }: { userAgent: string; maxTouchPoints?: number }) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
};

describe('useSafariDetection().isIOS', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'maxTouchPoints');
  });

  it('is true for an iPhone', () => {
    stubNavigator({ userAgent: IPHONE_UA, maxTouchPoints: 5 });

    expect(useSafariDetection().isIOS).toBe(true);
  });

  it('is true for an iPad', () => {
    stubNavigator({ userAgent: IPAD_UA, maxTouchPoints: 5 });

    expect(useSafariDetection().isIOS).toBe(true);
  });

  it('is true for iPadOS reporting as Macintosh with touch', () => {
    stubNavigator({ userAgent: MAC_UA, maxTouchPoints: 5 });

    expect(useSafariDetection().isIOS).toBe(true);
  });

  it('is false for a plain Mac', () => {
    stubNavigator({ userAgent: MAC_UA, maxTouchPoints: 0 });

    expect(useSafariDetection().isIOS).toBe(false);
  });

  it('is false for a desktop Chrome on Windows', () => {
    stubNavigator({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      maxTouchPoints: 10,
    });

    expect(useSafariDetection().isIOS).toBe(false);
  });
});
