export function useSafariDetection() {
  const userAgent = navigator.userAgent.toLowerCase();
  const isAppleDevice = /iphone|ipad|ipod/.test(userAgent);
  // iPadOS 13+ reports a Macintosh user agent; touch points tell it apart from a Mac.
  const isIOS = isAppleDevice || (userAgent.includes('macintosh') && navigator.maxTouchPoints > 1);
  const isSafariBrowser =
    userAgent.includes('safari') && !userAgent.includes('chrome') && !userAgent.includes('android');

  // CriOS = Chrome on iOS. All iOS browsers use WebKit, but Chrome adds its own UI chrome.
  const isIOSChrome = isAppleDevice && userAgent.includes('crios');

  // iOS uses navigator.standalone, other platforms use display-mode media query.
  const isIOSStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // Guard matchMedia for jsdom (vitest) and any non-browser host — jsdom omits it.
  const isDisplayModeStandalone =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  const isPWA = isIOSStandalone || isDisplayModeStandalone;

  const isSafari = isSafariBrowser;
  const isSafariMobile = isSafariBrowser && isAppleDevice && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  return {
    isSafari,
    isSafariMobile,
    isIOSChrome,
    isIOS,
    isPWA,
  };
}
