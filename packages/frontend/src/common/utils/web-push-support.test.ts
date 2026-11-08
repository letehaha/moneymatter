import { describe, expect, it } from 'vitest';

import { getPushSupport } from './web-push-support';

const fullWindow = ({ permission = 'default' }: { permission?: NotificationPermission } = {}) => ({
  navigator: { serviceWorker: {} },
  PushManager: {},
  Notification: { permission },
});

const desktop = { isIOS: false, isPWA: false };

describe('getPushSupport', () => {
  it('is unsupported without a service worker', () => {
    expect(getPushSupport({ win: { ...fullWindow(), navigator: {} }, detection: desktop })).toBe('unsupported');
  });

  it('is unsupported without PushManager outside iOS', () => {
    expect(getPushSupport({ win: { ...fullWindow(), PushManager: undefined }, detection: desktop })).toBe(
      'unsupported',
    );
  });

  it('is unsupported without the Notification API', () => {
    expect(getPushSupport({ win: { ...fullWindow(), Notification: undefined }, detection: desktop })).toBe(
      'unsupported',
    );
  });

  it.each(['default', 'denied', 'granted'] as const)('reports the %s permission', (permission) => {
    expect(getPushSupport({ win: fullWindow({ permission }), detection: desktop })).toBe(permission);
  });

  it('needs the Home Screen app in an iOS Safari tab, whatever the window exposes', () => {
    const iosTab = { isIOS: true, isPWA: false };

    expect(getPushSupport({ win: fullWindow(), detection: iosTab })).toBe('needs-home-screen');
    expect(getPushSupport({ win: { ...fullWindow(), PushManager: undefined, navigator: {} }, detection: iosTab })).toBe(
      'needs-home-screen',
    );
  });

  it('reports iPadOS posing as macOS (detected as iOS) as needing the Home Screen app too', () => {
    expect(getPushSupport({ win: fullWindow(), detection: { isIOS: true, isPWA: false } })).toBe('needs-home-screen');
  });

  it('reads the permission in an iOS Home Screen app that has PushManager', () => {
    const iosStandalone = { isIOS: true, isPWA: true };

    expect(getPushSupport({ win: fullWindow({ permission: 'default' }), detection: iosStandalone })).toBe('default');
    expect(getPushSupport({ win: fullWindow({ permission: 'granted' }), detection: iosStandalone })).toBe('granted');
  });

  it('is unsupported in an iOS Home Screen app without PushManager', () => {
    expect(
      getPushSupport({ win: { ...fullWindow(), PushManager: undefined }, detection: { isIOS: true, isPWA: true } }),
    ).toBe('unsupported');
  });

  it('does not require Home Screen on a desktop PWA', () => {
    expect(getPushSupport({ win: fullWindow(), detection: { isIOS: false, isPWA: true } })).toBe('default');
  });
});
