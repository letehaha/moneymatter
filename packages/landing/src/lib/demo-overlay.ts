import type { DemoStartLocation } from './posthog';
import { startDemo } from './start-demo';

type SetOverlayVisible = (payload: { visible: boolean }) => void;

let overlay: Promise<SetOverlayVisible> | undefined;

const loadOverlay = () =>
  (overlay ??= Promise.all([import('vue'), import('@/components/demo-loading-overlay.vue')])
    .then(([{ createApp, h, ref }, { default: DemoLoadingOverlay }]): SetOverlayVisible => {
      const isVisible = ref(false);
      createApp({ render: () => h(DemoLoadingOverlay, { isVisible: isVisible.value }) }).mount(
        document.body.appendChild(document.createElement('div')),
      );
      return ({ visible }) => {
        isVisible.value = visible;
      };
    })
    .catch((error): SetOverlayVisible => {
      console.error('Failed to load the demo loading overlay:', error);
      overlay = undefined;
      return () => {};
    }));

const hideOverlay = () => {
  void overlay?.then((setVisible) => setVisible({ visible: false }));
};

export const startDemoWithOverlay = async ({
  location,
  replaceHistory,
  onError,
}: {
  location: DemoStartLocation;
  replaceHistory?: boolean;
  onError: (payload: { message: string }) => void;
}) => {
  void loadOverlay().then((setVisible) => setVisible({ visible: true }));
  try {
    await startDemo({
      location,
      replaceHistory,
      onError: (payload) => {
        hideOverlay();
        onError(payload);
      },
    });
  } catch (error) {
    console.error('Failed to start demo:', error);
    hideOverlay();
    onError({ message: "Couldn't start the demo. Please try again." });
  }
};

// A bfcache restore brings back the overlay the page showed when the demo redirected away.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) hideOverlay();
});
