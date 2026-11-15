<template>
  <div
    ref="navbarRef"
    class="bg-background not-dark:border-border sticky right-0 bottom-0 left-0 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] not-dark:border-t max-sm:px-4"
  >
    <nav class="grid grid-cols-5 gap-1">
      <NavigationLinks bottom-nav />
    </nav>
  </div>
</template>

<script setup lang="ts">
import { useCssVarFromElementSize } from '@/composable/use-css-var-from-element-size';

import NavigationLinks from './sidebar/navigation-links.vue';

const { elementRef: navbarRef } = useCssVarFromElementSize({
  cssVars: [{ cssVarName: '--bottom-navbar-height', sizeSource: 'borderBoxSize' }],
});
</script>
