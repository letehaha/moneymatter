<template>
  <div
    v-if="state !== 'failed'"
    class="plate gha"
    :class="{ 'gha-loading': state === 'loading' }"
    :aria-busy="state === 'loading'"
  >
    <div class="gha-head">
      <h3>Repository activity</h3>
      <a
        :href="`${GITHUB_URL}/commits/main`"
        target="_blank"
        rel="noopener noreferrer"
        data-track="landing_github_clicked"
        data-track-location="community"
      >
        Commit history <span aria-hidden="true">↗</span>
      </a>
    </div>
    <div class="gha-body">
      <div class="gha-map">
        <div class="gha-weeks" role="img" :aria-label="summary">
          <i
            v-for="(commits, index) in weeks"
            :key="index"
            :data-l="level({ commits })"
            :title="weekTitle({ index, commits })"
          />
        </div>
        <div class="gha-axis" aria-hidden="true">
          <span class="gha-axis-long">{{ weeks.length - 1 }} weeks ago</span>
          <span class="gha-axis-short">{{ SHORT_WEEKS - 1 }} weeks ago</span>
          <span>This week</span>
        </div>
      </div>
      <dl class="gha-facts">
        <div>
          <dt>Commits, last 30 days</dt>
          <dd>
            <template v-if="activity">{{ activity.commitsLast30Days }}</template>
            <span v-else class="gha-ph" />
          </dd>
        </div>
        <div>
          <dt>Last push</dt>
          <dd>
            <time v-if="activity" :datetime="activity.lastUpdated" :title="fullDate({ iso: activity.lastUpdated })">
              {{ relativeDate({ iso: activity.lastUpdated }) }}
            </time>
            <span v-else class="gha-ph" />
          </dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fetchGitHubActivity, GITHUB_URL } from '@/lib/github-api';
import type { GitHubActivityData } from '@/lib/github-api';
import { computed, onMounted, ref } from 'vue';

const SKELETON_WEEKS = 12;
const SHORT_WEEKS = 8;
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const activity = ref<GitHubActivityData | null>(null);
const state = ref<'loading' | 'ready' | 'failed'>('loading');

const weeks = computed(() => activity.value?.recentWeeksActivity ?? Array<number>(SKELETON_WEEKS).fill(0));

const summary = computed(() => {
  if (!activity.value) return 'Loading repository activity';
  const total = weeks.value.reduce((sum, commits) => sum + commits, 0);
  return `${total} commits in the last ${weeks.value.length} weeks`;
});

function level({ commits }: { commits: number }): number {
  if (commits === 0) return 0;
  if (commits <= 5) return 1;
  if (commits <= 15) return 2;
  if (commits <= 30) return 3;
  return 4;
}

function weekTitle({ index, commits }: { index: number; commits: number }): string | undefined {
  if (!activity.value) return undefined;
  return `${commits} commits ${relativeTime.format(index + 1 - weeks.value.length, 'week')}`;
}

function fullDate({ iso }: { iso: string }): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeDate({ iso }: { iso: string }): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS));
  if (days < 7) return relativeTime.format(-days, 'day');
  if (days < 30) return relativeTime.format(-Math.floor(days / 7), 'week');
  return relativeTime.format(-Math.floor(days / 30), 'month');
}

onMounted(async () => {
  // A null response means GitHub is still computing the stats, which takes a few seconds.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const data = await fetchGitHubActivity();
      if (data?.recentWeeksActivity?.length) {
        activity.value = data;
        state.value = 'ready';
        return;
      }
    } catch (error) {
      console.warn('GitHub activity unavailable:', error);
      break;
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  state.value = 'failed';
});
</script>
