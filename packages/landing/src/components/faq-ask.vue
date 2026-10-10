<template>
  <div class="border-border/50 bg-card rounded-xl border px-5 py-4">
    <form class="flex items-center gap-3" @submit.prevent="submit">
      <input
        v-model="question"
        type="text"
        minlength="3"
        maxlength="300"
        required
        placeholder="Ask anything else…"
        aria-label="Ask a question about MoneyMatter"
        class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent font-semibold outline-none"
      />
      <button
        type="submit"
        :disabled="isLoading"
        aria-label="Ask"
        class="bg-primary text-primary-foreground hover:bg-primary/90 flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-4"
          :class="{ 'animate-pulse': isLoading }"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </button>
    </form>

    <div aria-live="polite">
      <p v-if="isLoading" class="text-muted-foreground mt-3 animate-pulse text-sm">Thinking…</p>
      <p v-else-if="error" class="text-destructive-text mt-3 text-sm">{{ error }}</p>
      <template v-else-if="answer">
        <p class="text-muted-foreground mt-3 text-sm leading-relaxed wrap-break-word whitespace-pre-line">
          <template v-for="(part, index) in answerParts" :key="index">
            <a
              v-if="index % 2"
              :href="part.includes('://') ? part : `mailto:${part}`"
              :target="part.includes('://') ? '_blank' : undefined"
              rel="noopener noreferrer nofollow"
              class="text-primary hover:underline"
            >
              {{ part }}
            </a>
            <template v-else>{{ part }}</template>
          </template>
        </p>
        <p class="text-muted-foreground/60 mt-2 text-xs">
          AI-generated, may be wrong. For anything important, email us at
          <a href="mailto:support@moneymatter.app" class="text-primary hover:underline">support@moneymatter.app</a>.
        </p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { askFaq } from '@/lib/ask-faq';
import { computed, ref } from 'vue';

// Punctuation and non-ASCII text right after a URL or email stay out of the link.
const LINK_PATTERN = /(https?:\/\/[^\s<>"')\u0080-￿]*[^\s<>"').,;:!?*_\]}\u0080-￿]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/;

const question = ref('');
const answer = ref('');
const error = ref('');
const isLoading = ref(false);

// Splitting on a capturing group puts the links at the odd indexes.
const answerParts = computed(() => answer.value.split(LINK_PATTERN));

async function submit() {
  if (isLoading.value) return;

  const trimmed = question.value.trim();

  answer.value = '';
  error.value = '';

  // `minlength` on the input counts surrounding spaces, the API does not.
  if (trimmed.length < 3) {
    error.value = 'Please ask a longer question.';
    return;
  }

  isLoading.value = true;

  try {
    const result = await askFaq({ question: trimmed });

    if ('answer' in result) {
      answer.value = result.answer;
    } else {
      error.value = result.error;
    }
  } finally {
    isLoading.value = false;
  }
}
</script>
