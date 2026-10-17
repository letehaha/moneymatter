<script setup lang="ts">
import { type SharedWithMeRow, leaveShare, listReceivedShareInvitations, listSharedWithMe } from '@/api/share';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { ROUTES_NAMES } from '@/routes';
import { RESOURCE_TYPES, type ResourceType, SHARE_INVITATION_STATUSES } from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { HomeIcon, LandmarkIcon, LogOutIcon, MailIcon, UsersIcon, WalletIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const queryClient = useQueryClient();
const route = useRoute();
const router = useRouter();

const ICON_BY_RESOURCE_TYPE: Record<ResourceType, typeof LandmarkIcon> = {
  [RESOURCE_TYPES.account]: LandmarkIcon,
  [RESOURCE_TYPES.household]: HomeIcon,
  [RESOURCE_TYPES.budget]: WalletIcon,
};

const sharesQuery = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.sharedWithMe,
  queryFn: listSharedWithMe,
});

// Pending invitations the recipient has received but not yet accepted/declined. Surfaces
// here as a fallback when the user missed (or dismissed) the in-app notification — the
// notification deep-link and this page are otherwise the only entry points to the
// accept/decline dialog.
const receivedInvitationsQuery = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsReceived,
  queryFn: listReceivedShareInvitations,
});

const pendingReceivedInvitations = computed(() =>
  (receivedInvitationsQuery.data.value ?? []).filter((inv) => inv.status === SHARE_INVITATION_STATUSES.pending),
);

// Reuses the existing dashboard-mounted `ShareInvitationDialog`, which opens whenever
// `?invitation_token=` is in the URL. Avoids duplicating the accept/decline + currency-
// mismatch error handling that already lives inside the dialog.
const reviewInvitation = (token: string) => {
  router.push({
    name: route.name ?? ROUTES_NAMES.settingsSharedWithMe,
    query: { ...route.query, invitation_token: token },
  });
};

// `route` is derived alongside the row to avoid recomputing it three times per render
// (template binds to `:is`, `:to`, and `:class`).
type DisplayableRow = SharedWithMeRow & { route: ReturnType<typeof routeForRow> };

const groupedShares = computed(() => {
  const groups: Record<ResourceType, DisplayableRow[]> = {
    [RESOURCE_TYPES.account]: [],
    [RESOURCE_TYPES.household]: [],
    [RESOURCE_TYPES.budget]: [],
  };
  for (const row of sharesQuery.data.value ?? []) {
    (groups[row.resourceType] ??= []).push({ ...row, route: routeForRow(row) });
  }
  return groups;
});

const leaveTarget = ref<SharedWithMeRow | null>(null);
const leaveOpen = ref(false);
const openLeave = (row: SharedWithMeRow) => {
  leaveTarget.value = row;
  leaveOpen.value = true;
};

const leaveMutation = useMutation({
  mutationFn: leaveShare,
  onSuccess: () => {
    addSuccessNotification(t('pages.sharedWithMe.leaveSuccess'));
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.sharedWithMe });
    // The recipient's resource lists also drop this row. Invalidating both is a no-op for
    // the bucket the row didn't live in, so we don't need to branch on `resourceType`.
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.allAccounts });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsListItem });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetStats });
    leaveOpen.value = false;
    leaveTarget.value = null;
  },
  onError: (err) => {
    const message = err instanceof ApiErrorResponseError ? err.data?.message : undefined;
    addErrorNotification(message || t('pages.sharedWithMe.leaveError'));
  },
});

const confirmLeave = () => {
  if (!leaveTarget.value) return;
  leaveMutation.mutate({
    resourceType: leaveTarget.value.resourceType,
    resourceId: leaveTarget.value.resourceId,
  });
};

const routeForRow = (row: SharedWithMeRow) => {
  if (row.resourceType === RESOURCE_TYPES.account) {
    return { name: ROUTES_NAMES.account, params: { id: row.resourceId } };
  }
  if (row.resourceType === RESOURCE_TYPES.household) {
    // Household rows route to Settings → Household where the member can review their
    // membership and leave from a single place. The shared-with-me page itself still
    // offers a Leave action inline, so the link is purely an entry to the manage UI.
    return { name: ROUTES_NAMES.settingsHousehold };
  }
  if (row.resourceType === RESOURCE_TYPES.budget) {
    return { name: ROUTES_NAMES.plannedBudgetDetails, params: { id: row.resourceId } };
  }
  return null;
};

const isEverythingEmpty = computed(() => !pendingReceivedInvitations.value.length && !sharesQuery.data.value?.length);
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
      <h1 class="text-2xl tracking-wider">{{ $t('pages.sharedWithMe.title') }}</h1>
    </div>

    <template v-if="sharesQuery.isLoading.value || receivedInvitationsQuery.isLoading.value">
      <div class="grid gap-3">
        <div v-for="i in 3" :key="i" class="bg-muted h-20 w-full animate-pulse rounded-lg" />
      </div>
    </template>

    <template v-else-if="sharesQuery.isError.value || receivedInvitationsQuery.isError.value">
      <p class="text-destructive-text text-sm">{{ $t('pages.sharedWithMe.loadError') }}</p>
    </template>

    <template v-else-if="isEverythingEmpty">
      <div class="py-12 text-center">
        <div class="mb-4">
          <UsersIcon class="text-muted-foreground mx-auto size-12" />
        </div>
        <h3 class="text-foreground mb-2 text-lg font-medium">{{ $t('pages.sharedWithMe.empty.title') }}</h3>
        <p class="text-muted-foreground">{{ $t('pages.sharedWithMe.empty.description') }}</p>
      </div>
    </template>

    <template v-else>
      <div class="grid gap-6">
        <section v-if="pendingReceivedInvitations.length" class="grid gap-3">
          <h2 class="xs:text-lg text-base font-semibold">{{ $t('pages.sharedWithMe.pending.heading') }}</h2>

          <div class="grid gap-3">
            <div
              v-for="invitation in pendingReceivedInvitations"
              :key="invitation.id"
              class="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
            >
              <div class="flex min-w-0 flex-1 items-center gap-3">
                <div
                  class="bg-primary/10 text-primary-text flex size-10 shrink-0 items-center justify-center rounded-full"
                >
                  <MailIcon class="size-5" />
                </div>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">
                    {{ invitation.resourceName ?? $t('pages.sharedWithMe.unnamedResource') }}
                  </p>
                  <p class="text-muted-foreground truncate text-xs">
                    <template v-if="invitation.owner">
                      {{ $t('pages.sharedWithMe.sharedBy', { handle: `@${invitation.owner.username}` }) }}
                      ·
                    </template>
                    {{ $t(`pages.sharedWithMe.permissions.${invitation.permission}`) }}
                  </p>
                </div>
              </div>

              <Button variant="default" size="sm" @click="reviewInvitation(invitation.token)">
                {{ $t('pages.sharedWithMe.pending.review') }}
              </Button>
            </div>
          </div>
        </section>

        <template v-for="(rows, type) in groupedShares" :key="type">
          <section v-if="rows.length" class="grid gap-3">
            <h2 class="xs:text-lg text-base font-semibold">
              {{ $t(`pages.sharedWithMe.sections.${type}`) }}
            </h2>

            <div class="grid gap-3">
              <div
                v-for="row in rows"
                :key="row.shareId"
                class="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
              >
                <component
                  :is="row.route ? 'router-link' : 'div'"
                  :to="row.route ?? undefined"
                  class="flex min-w-0 flex-1 items-center gap-3"
                  :class="row.route ? 'hover:opacity-80' : ''"
                >
                  <div
                    class="bg-primary/10 text-primary-text flex size-10 shrink-0 items-center justify-center rounded-full"
                  >
                    <component :is="ICON_BY_RESOURCE_TYPE[row.resourceType]" class="size-5" />
                  </div>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                      {{ row.resourceName ?? $t('pages.sharedWithMe.unnamedResource') }}
                    </p>
                    <p class="text-muted-foreground truncate text-xs">
                      <template v-if="row.resourceType === RESOURCE_TYPES.household">
                        {{ $t('pages.sharedWithMe.viaHousehold', { handle: `@${row.owner.username}` }) }}
                      </template>
                      <template v-else>
                        {{ $t('pages.sharedWithMe.sharedBy', { handle: `@${row.owner.username}` }) }}
                      </template>
                      ·
                      {{ $t(`pages.sharedWithMe.permissions.${row.permission}`) }}
                    </p>
                  </div>
                </component>

                <Button
                  variant="soft-destructive"
                  size="sm"
                  :disabled="leaveMutation.isPending.value"
                  @click="openLeave(row)"
                >
                  <LogOutIcon class="mr-2 size-4" />
                  {{ $t('pages.sharedWithMe.leave') }}
                </Button>
              </div>
            </div>
          </section>
        </template>
      </div>
    </template>

    <ResponsiveAlertDialog
      v-model:open="leaveOpen"
      :confirm-label="$t('pages.sharedWithMe.leaveConfirm')"
      confirm-variant="destructive"
      :confirm-disabled="leaveMutation.isPending.value"
      @confirm="confirmLeave"
    >
      <template #title>{{ $t('pages.sharedWithMe.leaveTitle') }}</template>
      <template #description>
        {{
          $t('pages.sharedWithMe.leaveDescription', {
            resource: leaveTarget?.resourceName ?? '',
            owner: leaveTarget?.owner.username ?? '',
          })
        }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
