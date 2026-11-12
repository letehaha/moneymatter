<template>
  <div class="plate faq-ask" :class="{ busy: isLoading }">
    <form class="faq-ask-form" @submit.prevent="submit">
      <span class="itile sm"
        ><svg aria-hidden="true" class="ic"><use href="#r-spark" /></svg
      ></span>
      <input
        v-model="question"
        type="text"
        minlength="3"
        maxlength="300"
        required
        placeholder="Ask anything else…"
        aria-label="Ask a question about MoneyMatter"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? 'faq-ask-error' : undefined"
      />
      <button type="submit" :disabled="isLoading" aria-label="Ask">
        <svg aria-hidden="true" class="ic"><use href="#f-to" /></svg>
      </button>
    </form>

    <div aria-live="polite">
      <div class="faq-ask-out" :hidden="!isLoading && !error && !answer">
        <p v-if="isLoading" class="faq-ask-text">Thinking…</p>
        <p v-else-if="error" id="faq-ask-error" class="faq-ask-text text-destructive-text">{{ error }}</p>
        <template v-else-if="answer">
          <p class="faq-ask-text wrap-break-word whitespace-pre-line">
            <template v-for="(part, index) in answerParts" :key="index">
              <a
                v-if="index % 2"
                :href="part.includes('://') ? part : `mailto:${part}`"
                :target="part.includes('://') ? '_blank' : undefined"
                rel="noopener noreferrer nofollow"
                class="text-primary-text underline"
              >
                {{ part }}
              </a>
              <template v-else>{{ part }}</template>
            </template>
          </p>
          <p class="faq-ask-note">
            AI-generated, may be wrong. For anything important, email us at
            <a :href="`mailto:${SUPPORT_EMAIL}`">{{ SUPPORT_EMAIL }}</a
            >.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { askFaq } from '@/lib/ask-faq';
import { SUPPORT_EMAIL } from '@/lib/github-api';
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
