<template>
  <div class="h-dvh overflow-y-auto">
    <div class="flex min-h-full items-center justify-center p-4">
      <Card class="w-full max-w-md">
        <CardHeader class="text-center">
          <div class="bg-primary/10 mx-auto mb-4 flex size-16 items-center justify-center rounded-full">
            <ShieldCheckIcon class="text-primary-text size-8" />
          </div>
          <h1 class="text-xl font-semibold">
            {{ $t('oauth.authorize.title', { name: clientName }) }}
          </h1>
          <i18n-t
            v-if="redirectTarget"
            keypath="oauth.authorize.redirect_notice"
            tag="p"
            class="text-muted-foreground mt-2 text-sm"
          >
            <template #host>
              <span class="text-foreground font-medium break-all">{{ redirectTarget }}</span>
            </template>
          </i18n-t>
        </CardHeader>

        <CardContent class="flex flex-col gap-6">
          <div>
            <p class="text-muted-foreground mb-3 text-sm font-medium">
              {{ $t('oauth.authorize.description') }}
            </p>

            <ul class="space-y-3">
              <li
                v-for="item in scopeItems"
                :key="item.scope"
                :class="
                  cn('flex gap-3 rounded-md border p-3', item.destructive && 'border-destructive/40 bg-destructive/5')
                "
              >
                <div class="pt-0.5">
                  <Checkbox
                    v-if="item.togglable"
                    :model-value="approvals[item.scope]"
                    :aria-label="$t(item.labelKey)"
                    @update:model-value="(val) => (approvals[item.scope] = !!val)"
                  />
                  <CheckCircleIcon v-else class="text-app-income-color size-4" />
                </div>

                <div class="flex-1 text-sm">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium">{{ $t(item.labelKey) }}</span>
                    <span
                      :class="
                        cn(
                          'rounded-full px-2 py-0.5 text-xs',
                          item.togglable
                            ? item.destructive
                              ? 'bg-destructive/10 text-destructive-text'
                              : 'bg-muted text-muted-foreground'
                            : 'bg-muted text-muted-foreground',
                        )
                      "
                    >
                      {{ item.togglable ? $t('oauth.authorize.optional') : $t('oauth.authorize.always_granted') }}
                    </span>
                  </div>
                  <p class="text-muted-foreground mt-1">{{ $t(item.descKey) }}</p>
                  <p v-if="item.destructive" class="text-destructive-text mt-2 flex items-center gap-1.5 text-xs">
                    <AlertTriangleIcon class="size-3.5 shrink-0" />
                    {{ $t('oauth.authorize.delete_warning') }}
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <Separator />

          <div class="flex gap-3">
            <UiButton
              variant="outline"
              class="flex-1"
              :disabled="isSubmitting"
              @click="submitConsent({ accept: false })"
            >
              {{ $t('oauth.authorize.deny') }}
            </UiButton>
            <UiButton
              class="flex-1"
              :disabled="isSubmitting"
              :loading="isSubmitting"
              @click="submitConsent({ accept: true })"
            >
              {{ $t('oauth.authorize.approve') }}
            </UiButton>
          </div>

          <p class="text-muted-foreground text-center text-xs">
            {{ $t('oauth.authorize.footer') }}
          </p>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getOAuthClientName, submitOAuthConsent } from '@/api/mcp';
import { HIDDEN_OAUTH_SCOPES } from '@/common/const/oauth-scopes';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { Separator } from '@/components/lib/ui/separator';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { cn } from '@/lib/utils';
import { AlertTriangleIcon, CheckCircleIcon, ShieldCheckIcon } from '@lucide/vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

interface ScopeMeta {
  scope: string;
  labelKey: string;
  descKey: string;
  togglable: boolean;
  defaultOn: boolean;
  destructive?: boolean;
}

const KNOWN_SCOPES: ScopeMeta[] = [
  {
    scope: 'finance:read',
    labelKey: 'oauth.scopes.finance_read.label',
    descKey: 'oauth.scopes.finance_read.desc',
    togglable: false,
    defaultOn: true,
  },
  {
    scope: 'finance:write',
    labelKey: 'oauth.scopes.finance_write.label',
    descKey: 'oauth.scopes.finance_write.desc',
    togglable: true,
    defaultOn: true,
  },
  {
    scope: 'finance:delete',
    labelKey: 'oauth.scopes.finance_delete.label',
    descKey: 'oauth.scopes.finance_delete.desc',
    togglable: true,
    defaultOn: false,
    destructive: true,
  },
  {
    scope: 'profile:read',
    labelKey: 'oauth.scopes.profile_read.label',
    descKey: 'oauth.scopes.profile_read.desc',
    togglable: false,
    defaultOn: true,
  },
  {
    scope: 'offline_access',
    labelKey: 'oauth.scopes.offline_access.label',
    descKey: 'oauth.scopes.offline_access.desc',
    togglable: false,
    defaultOn: true,
  },
];

const SCOPE_META_BY_KEY: Record<string, ScopeMeta> = Object.fromEntries(KNOWN_SCOPES.map((s) => [s.scope, s]));

const route = useRoute();
const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const isSubmitting = ref(false);
const fetchedClientName = ref<string | null>(null);

const clientId = computed(() => (route.query.client_id as string) || '');

const clientName = computed(() => {
  if (fetchedClientName.value) return fetchedClientName.value;
  return clientId.value || t('oauth.authorize.unknown_app');
});

// The client name is chosen by whoever registered the client, so the redirect
// host is the only thing on this screen that identifies where the code goes.
const redirectTarget = computed(() => {
  const raw = route.query.redirect_uri;
  if (typeof raw !== 'string' || !URL.canParse(raw)) return '';
  return new URL(raw).host || raw;
});

const requestedScopes = computed<string[]>(() => {
  const raw = route.query.scope;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw.split(/\s+/).filter(Boolean);
});

const scopeItems = computed<ScopeMeta[]>(() =>
  requestedScopes.value
    .filter((s) => !HIDDEN_OAUTH_SCOPES.has(s))
    .map(
      (s): ScopeMeta =>
        SCOPE_META_BY_KEY[s] ?? {
          scope: s,
          labelKey: 'oauth.scopes.unknown.label',
          descKey: 'oauth.scopes.unknown.desc',
          togglable: false,
          defaultOn: true,
        },
    ),
);

const approvals = reactive<Record<string, boolean>>({});

function initApprovals() {
  for (const item of scopeItems.value) {
    if (item.togglable) approvals[item.scope] = item.defaultOn;
  }
}

initApprovals();

const approvedScopeString = computed(() => {
  const approved = requestedScopes.value.filter((s) => {
    if (HIDDEN_OAUTH_SCOPES.has(s)) return true;
    const meta = SCOPE_META_BY_KEY[s];
    if (!meta) return true;
    if (!meta.togglable) return true;
    return approvals[s] === true;
  });
  return approved.join(' ');
});

// Must be the raw query string: better-auth signs it verbatim and emits
// repeated keys (ba_param), which route.query would collapse into one value.
const oauthQuery = computed(() => window.location.search.slice(1));

onMounted(async () => {
  if (clientId.value) {
    try {
      const { name } = await getOAuthClientName({ clientId: clientId.value });
      fetchedClientName.value = name;
    } catch {
      // Fall through to fallback name
    }
  }
});

async function submitConsent({ accept }: { accept: boolean }) {
  isSubmitting.value = true;
  try {
    const response = await submitOAuthConsent({
      oauthQuery: oauthQuery.value,
      accept,
      scope: accept ? approvedScopeString.value : undefined,
    });

    if (response.redirected) {
      window.location.href = response.url;
      return;
    }

    if (response.ok) {
      const data = await response.json();
      const redirectUrl = data.url || data.redirectTo;
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
    }

    if (!accept) {
      window.close();
      return;
    }

    addNotification({
      id: 'oauth-consent-error',
      text: t('oauth.authorize.unexpected_response'),
      type: NotificationType.error,
    });
    isSubmitting.value = false;
  } catch {
    addNotification({
      id: 'oauth-consent-error',
      text: t('oauth.authorize.error'),
      type: NotificationType.error,
    });
    isSubmitting.value = false;
  }
}
</script>
