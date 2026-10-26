<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #trigger>
      <slot />
    </template>

    <template #title>{{ $t('feedback.dialog.title') }}</template>
    <template #description>{{ $t('feedback.dialog.description') }}</template>

    <form class="grid gap-4" @submit.prevent="submit">
      <SelectField
        v-model="feedbackType"
        :values="feedbackTypeOptions"
        :label="$t('feedback.dialog.typeLabel')"
        :placeholder="$t('feedback.dialog.typePlaceholder')"
        label-key="label"
        value-key="value"
      />

      <i18n-t keypath="feedback.dialog.docsHint" tag="p" class="text-muted-foreground text-xs">
        <template #link>
          <DocsLink path="/">{{ $t('feedback.dialog.docsHintLink') }}</DocsLink>
        </template>
      </i18n-t>

      <TextareaField
        v-model="message"
        :label="$t('feedback.dialog.messageLabel')"
        :placeholder="$t('feedback.dialog.messagePlaceholder')"
        :error-message="errorMessage"
        :maxlength="MAX_FEEDBACK_MESSAGE_LENGTH"
        rows="5"
      />

      <UiButton type="submit" class="w-full" :disabled="!canSubmit">
        {{ $t('feedback.dialog.submit') }}
      </UiButton>
    </form>

    <div class="text-muted-foreground my-5 flex items-center gap-3 text-xs tracking-wide uppercase">
      <span class="border-border flex-1 border-t" />
      {{ $t('feedback.dialog.or') }}
      <span class="border-border flex-1 border-t" />
    </div>

    <div class="grid gap-3">
      <a
        v-for="link in externalLinks"
        :key="link.href"
        :href="link.href"
        target="_blank"
        rel="noopener noreferrer"
        class="border-border hover:border-primary/40 hover:bg-accent group flex items-start gap-3 rounded-lg border p-4 transition-colors"
      >
        <component
          :is="link.icon"
          class="text-muted-foreground group-hover:text-primary-text mt-0.5 size-5 shrink-0 transition-colors"
        />

        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5 text-sm font-medium">
            {{ link.title }}
            <ExternalLinkIcon class="size-3.5 opacity-50 transition-opacity group-hover:opacity-100" />
          </span>
          <span class="text-muted-foreground mt-1 block text-sm leading-relaxed">
            {{ link.description }}
          </span>
        </span>
      </a>
    </div>
  </ResponsiveDialog>
</template>

<script lang="ts" setup>
import DocsLink from '@/components/common/docs-link.vue';
import RedditIcon from '@/components/common/icons/reddit-icon.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import SelectField from '@/components/fields/select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { EXTERNAL_URLS } from '@bt/shared/const/external-urls';
import { ExternalLinkIcon, UsersIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { type FeedbackType, MAX_FEEDBACK_MESSAGE_LENGTH, buildFeedbackSubmission } from './feedback-submission';

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();

const isOpen = ref(false);
const message = ref('');
const errorMessage = ref('');

const feedbackTypeOptions = computed<{ value: FeedbackType; label: string }[]>(() => [
  { value: 'bug', label: t('feedback.dialog.types.bug') },
  { value: 'feature_request', label: t('feedback.dialog.types.featureRequest') },
  { value: 'other', label: t('feedback.dialog.types.other') },
]);

const externalLinks = computed(() => [
  {
    href: EXTERNAL_URLS.redditCommunity,
    icon: RedditIcon,
    title: t('feedback.dialog.reddit.title'),
    description: t('feedback.dialog.reddit.description'),
  },
  {
    href: EXTERNAL_URLS.featurebaseBoard,
    icon: UsersIcon,
    title: t('feedback.dialog.board.title'),
    description: t('feedback.dialog.board.description'),
  },
]);

const feedbackType = ref<{ value: FeedbackType; label: string } | null>(feedbackTypeOptions.value[0]!);

const canSubmit = computed(() => message.value.trim().length > 0 && Boolean(feedbackType.value));

// The message rides along on the PostHog event; nothing in the app reads feedback back, so
// persisting it would mean a table, an endpoint and a moderation story. When analytics is off
// the event goes nowhere, so the dialog keeps the typed message and points at the board below.
function submit() {
  const submission = buildFeedbackSubmission({
    message: message.value,
    feedbackType: feedbackType.value?.value ?? null,
  });

  if (!submission) {
    errorMessage.value = t('feedback.dialog.messageRequired');
    return;
  }

  const sent = trackAnalyticsEvent({ event: 'user_feedback_submitted', properties: submission });

  if (!sent) {
    errorMessage.value = t('feedback.dialog.unavailable');
    return;
  }

  addSuccessNotification(t('feedback.dialog.thanks'));

  message.value = '';
  errorMessage.value = '';
  feedbackType.value = feedbackTypeOptions.value[0]!;
  isOpen.value = false;
}
</script>
