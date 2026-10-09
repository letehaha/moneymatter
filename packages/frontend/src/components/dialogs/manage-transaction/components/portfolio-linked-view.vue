<script lang="ts" setup>
import DeletedBadge from '@/components/common/deleted-badge.vue';
import * as AlertDialog from '@/components/lib/ui/alert-dialog';
import { Button } from '@/components/lib/ui/button';
import {
  useTransactionPortfolioLink,
  useUnlinkTransactionFromPortfolio,
} from '@/composable/data-queries/portfolio-transfers';
import { formatUIAmount } from '@/js/helpers';
import { ROUTES_NAMES } from '@/routes';
import type { TransactionModel } from '@bt/shared/types';
import { DialogClose, DialogTitle } from 'reka-ui';
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';

const props = defineProps<{
  transaction: TransactionModel;
}>();

const emit = defineEmits<{
  'close-modal': [];
}>();

const transactionId = computed(() => props.transaction.id);
const { data: linkData, isLoading } = useTransactionPortfolioLink(transactionId);
const unlinkMutation = useUnlinkTransactionFromPortfolio();

const isAlertOpen = ref(false);

const handleUnlink = () => {
  unlinkMutation.mutate(
    { transactionId: props.transaction.id },
    {
      onSuccess: () => {
        isAlertOpen.value = false;
        emit('close-modal');
      },
    },
  );
};
</script>

<template>
  <div class="rounded-t-xl">
    <div class="bg-app-transfer-color h-3 rounded-t-lg" />
    <div class="mb-4 flex items-center justify-between px-6 py-3">
      <DialogTitle>
        <span class="text-2xl">
          {{ $t('dialogs.manageTransaction.portfolioLinked.title') }}
        </span>
      </DialogTitle>

      <DialogClose>
        <Button variant="ghost" @click="emit('close-modal')">
          {{ $t('dialogs.manageTransaction.form.closeButton') }}
        </Button>
      </DialogClose>
    </div>

    <div class="px-6 pb-6">
      <template v-if="isLoading">
        <div class="text-muted-foreground py-8 text-center text-sm">
          {{ $t('common.loading') }}
        </div>
      </template>

      <template v-else-if="linkData">
        <div class="bg-muted/30 border-border rounded-lg border p-4">
          <p class="text-sm">
            {{
              $t('dialogs.manageTransaction.portfolioLinked.linkedAs', {
                type:
                  linkData.transferType === 'deposit'
                    ? $t('dialogs.manageTransaction.portfolioLinked.deposit')
                    : $t('dialogs.manageTransaction.portfolioLinked.withdrawal'),
              })
            }}
            <template v-if="linkData.isPortfolioDeleted">
              <span class="text-muted-foreground line-through">{{ linkData.portfolioName }}</span>
              <DeletedBadge class="ml-2" />
            </template>
            <RouterLink
              v-else
              :to="{ name: ROUTES_NAMES.portfolioDetail, params: { portfolioId: linkData.portfolioId } }"
              class="text-primary-text underline underline-offset-2"
              @click="emit('close-modal')"
            >
              {{ linkData.portfolioName }}
            </RouterLink>
          </p>
          <p class="text-muted-foreground mt-2 text-sm">
            {{ formatUIAmount(Number(linkData.amount), { currency: linkData.currencyCode }) }}
            &middot;
            {{ linkData.date }}
            <span
              v-if="!linkData.affectsCash"
              class="bg-muted text-muted-foreground ml-2 rounded-full px-2 py-0.5 text-xs font-medium tracking-wide uppercase"
            >
              {{ $t('dialogs.manageTransaction.portfolioLinked.noCashBadge') }}
            </span>
          </p>
        </div>

        <AlertDialog.AlertDialog v-model:open="isAlertOpen">
          <AlertDialog.AlertDialogTrigger as-child>
            <Button variant="outline" class="mt-4 w-full">
              {{ $t('dialogs.manageTransaction.portfolioLinked.unlinkButton') }}
            </Button>
          </AlertDialog.AlertDialogTrigger>
          <AlertDialog.AlertDialogContent>
            <AlertDialog.AlertDialogHeader>
              <AlertDialog.AlertDialogTitle>
                {{ $t('dialogs.manageTransaction.portfolioLinked.unlinkButton') }}
              </AlertDialog.AlertDialogTitle>
              <AlertDialog.AlertDialogDescription>
                {{
                  $t(
                    linkData.affectsCash
                      ? 'dialogs.manageTransaction.portfolioLinked.unlinkWarning'
                      : 'dialogs.manageTransaction.portfolioLinked.unlinkWarningNoCash',
                    { portfolio: linkData.portfolioName },
                  )
                }}
                {{ $t('dialogs.manageTransaction.portfolioLinked.unlinkDescription') }}
              </AlertDialog.AlertDialogDescription>
            </AlertDialog.AlertDialogHeader>
            <AlertDialog.AlertDialogFooter>
              <AlertDialog.AlertDialogCancel>
                {{ $t('dialogs.manageTransaction.portfolioLinked.cancelButton') }}
              </AlertDialog.AlertDialogCancel>
              <AlertDialog.AlertDialogAction
                variant="destructive"
                :disabled="unlinkMutation.isPending.value"
                @click="handleUnlink"
              >
                {{ $t('dialogs.manageTransaction.portfolioLinked.confirmUnlink') }}
              </AlertDialog.AlertDialogAction>
            </AlertDialog.AlertDialogFooter>
          </AlertDialog.AlertDialogContent>
        </AlertDialog.AlertDialog>
      </template>
    </div>
  </div>
</template>
