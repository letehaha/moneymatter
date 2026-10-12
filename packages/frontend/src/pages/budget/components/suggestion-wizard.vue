<script setup lang="ts">
import { loadBudgetSuggestionContext } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Label } from '@/components/lib/ui/label';
import { Switch } from '@/components/lib/ui/switch';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import {
  BUDGET_SUGGESTION_DETAILS,
  BUDGET_SUGGESTION_EATS_OUT,
  BUDGET_SUGGESTION_HOUSING,
  BUDGET_SUGGESTION_PETS,
  BUDGET_SUGGESTION_SUBSCRIPTIONS,
  BUDGET_SUGGESTION_TRANSPORT,
  type BudgetSuggestionAnswers,
} from '@bt/shared/types';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BikeIcon,
  BusIcon,
  CarIcon,
  CatIcon,
  CreditCardIcon,
  DogIcon,
  FishIcon,
  HouseIcon,
  KeyRoundIcon,
  LandmarkIcon,
  RouteIcon,
  UsersIcon,
  UtensilsIcon,
} from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import SuggestionTiles, { type SuggestionTile } from './suggestion-tiles.vue';

const props = defineProps<{
  accountIds: string[];
  submitLabel: string;
  isSubmitting: boolean;
}>();
/** `submit` without answers asks for the default lines. */
const emit = defineEmits<{ back: []; submit: [answers?: BudgetSuggestionAnswers] }>();

type Step = 'home' | 'life' | 'focus' | 'detail';
const SKELETON_TILES = 6;

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();
const { categoriesMap } = storeToRefs(useCategoriesStore());

const stepIndex = ref(0);
const housing = ref<BudgetSuggestionAnswers['housing']>();
const transport = ref<BudgetSuggestionAnswers['transport']>();
// Unset until the switch is touched, so an untouched switch is not sent as "no pets".
const pets = ref<BudgetSuggestionAnswers['pets']>();
const hasPets = computed(() => !!pets.value && pets.value !== 'none');
const eatsOut = ref<BudgetSuggestionAnswers['eatsOut']>();
const subscriptions = ref<BudgetSuggestionAnswers['subscriptions']>();
const focusCategoryIds = ref<string[]>([]);
const detail = ref<NonNullable<BudgetSuggestionAnswers['detail']>>('balanced');
const isDefaultsConfirmOpen = ref(false);

const contextQuery = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetSuggestionContext, props.accountIds]),
  queryFn: () => loadBudgetSuggestionContext({ accountIds: props.accountIds }),
  // A refetch mid-wizard could swap the step list under the user.
  staleTime: Infinity,
});
const hasHistory = computed(() => contextQuery.data.value?.hasHistory ?? false);

const HOUSING_ICONS = { mortgage: LandmarkIcon, rent: KeyRoundIcon, family: UsersIcon, owned: HouseIcon };
const TRANSPORT_ICONS = { car: CarIcon, transit: BusIcon, bikeWalk: BikeIcon, multiple: RouteIcon };
const PET_ICONS = { dog: DogIcon, cat: CatIcon, other: FishIcon };

const housingItems = computed(() =>
  BUDGET_SUGGESTION_HOUSING.map((value) => ({
    value,
    label: t(`budgetPlans.suggest.housing.${value}`),
    icon: HOUSING_ICONS[value],
  })),
);
const transportItems = computed(() =>
  BUDGET_SUGGESTION_TRANSPORT.map((value) => ({
    value,
    label: t(`budgetPlans.suggest.transport.${value}`),
    icon: TRANSPORT_ICONS[value],
  })),
);
const petKindItems = computed(() =>
  BUDGET_SUGGESTION_PETS.flatMap((value) =>
    value === 'none' ? [] : [{ value, label: t(`budgetPlans.suggest.pets.${value}`), icon: PET_ICONS[value] }],
  ),
);
const eatsOutItems = computed(() =>
  BUDGET_SUGGESTION_EATS_OUT.map((value) => ({
    value,
    label: t(`budgetPlans.suggest.eatsOut.${value}`),
    icon: UtensilsIcon,
  })),
);
const subscriptionItems = computed(() =>
  BUDGET_SUGGESTION_SUBSCRIPTIONS.map((value) => ({
    value,
    label: t(`budgetPlans.suggest.subscriptions.${value}`),
    icon: CreditCardIcon,
  })),
);
const focusItems = computed<SuggestionTile<string>[]>(() =>
  (contextQuery.data.value?.categories ?? []).flatMap(({ id, monthlyAvg }) => {
    const category = categoriesMap.value[id];
    if (!category) return [];
    return [
      {
        value: id,
        label: category.name,
        categoryId: id,
        hint:
          monthlyAvg === null
            ? undefined
            : t('budgetPlans.suggest.focus.perMonth', { amount: formatBaseCurrency(monthlyAvg) }),
      },
    ];
  }),
);
const detailItems = computed(() =>
  BUDGET_SUGGESTION_DETAILS.map((value) => ({
    value,
    label: t(`budgetPlans.suggest.detail.${value}`),
    hint: t(`budgetPlans.suggest.detail.${value}Hint`),
  })),
);

// Spending already shows how a user with history lives, so they only pick a focus and a detail level.
const steps = computed(() => {
  const all: Step[] = hasHistory.value ? ['focus', 'detail'] : ['home', 'life', 'focus', 'detail'];
  return all.filter((name) => name !== 'focus' || focusItems.value.length > 0);
});
const step = computed(() => steps.value[stepIndex.value]);
const isLastStep = computed(() => stepIndex.value === steps.value.length - 1);
// An index into a list that just changed would point at a different step, or past the end.
watch(
  () => steps.value.join(),
  () => (stepIndex.value = 0),
);

const goBack = () => {
  if (stepIndex.value === 0) return emit('back');
  stepIndex.value -= 1;
};

const goNext = () => {
  if (!isLastStep.value) {
    stepIndex.value += 1;
    return;
  }
  emit('submit', {
    detail: detail.value,
    focusCategoryIds: focusCategoryIds.value,
    housing: housing.value,
    transport: transport.value,
    pets: pets.value,
    eatsOut: eatsOut.value,
    subscriptions: subscriptions.value,
  });
};
</script>

<template>
  <div v-if="contextQuery.isPending.value" class="grid animate-pulse gap-4" aria-hidden="true">
    <div class="bg-muted h-5 rounded-md" />
    <div class="grid grid-cols-3 gap-2">
      <div v-for="index in SKELETON_TILES" :key="index" class="bg-muted h-20 rounded-md" />
    </div>
  </div>

  <div v-else-if="contextQuery.isError.value" class="grid gap-4">
    <p class="text-destructive-text text-sm">{{ $t('budgetPlans.suggest.contextError') }}</p>
    <div class="flex items-center justify-between gap-2">
      <Button type="button" variant="outline" @click="emit('back')">
        <ArrowLeftIcon class="size-4" />
        {{ $t('budgetPlans.suggest.back') }}
      </Button>
      <Button type="button" @click="contextQuery.refetch()">{{ $t('budgetPlans.suggest.retry') }}</Button>
    </div>
  </div>

  <div v-else class="grid gap-4">
    <p class="text-muted-foreground text-sm">
      {{ $t(hasHistory ? 'budgetPlans.suggest.descriptionHistory' : 'budgetPlans.suggest.descriptionNoHistory') }}
    </p>

    <ol
      class="flex items-center justify-center gap-2"
      :aria-label="$t('budgetPlans.suggest.step', { current: stepIndex + 1, total: steps.length })"
    >
      <li
        v-for="(name, index) in steps"
        :key="name"
        :aria-current="index === stepIndex ? 'step' : undefined"
        :class="
          cn(
            'bg-muted text-muted-foreground flex h-6 w-7 items-center justify-center rounded-md text-xs font-medium tabular-nums',
            index < stepIndex && 'bg-primary/10 text-primary-text',
            index === stepIndex && 'bg-primary text-primary-foreground',
          )
        "
      >
        {{ index + 1 }}
      </li>
    </ol>

    <template v-if="step === 'home'">
      <p class="text-sm font-medium">{{ $t('budgetPlans.suggest.housing.question') }}</p>
      <SuggestionTiles v-model="housing" :items="housingItems" />
      <p class="text-sm font-medium">{{ $t('budgetPlans.suggest.transport.question') }}</p>
      <SuggestionTiles v-model="transport" :items="transportItems" />
    </template>

    <template v-else-if="step === 'life'">
      <div class="flex items-center justify-between gap-3">
        <Label for="budget-suggest-pets" class="cursor-pointer text-sm font-medium">
          {{ $t('budgetPlans.suggest.pets.question') }}
        </Label>
        <Switch
          id="budget-suggest-pets"
          :model-value="hasPets"
          @update:model-value="(on) => (pets = on ? 'other' : 'none')"
        />
      </div>
      <template v-if="hasPets">
        <p class="text-sm font-medium">{{ $t('budgetPlans.suggest.pets.kindQuestion') }}</p>
        <SuggestionTiles v-model="pets" :items="petKindItems" :columns="3" />
      </template>
      <p class="text-sm font-medium">{{ $t('budgetPlans.suggest.eatsOut.question') }}</p>
      <SuggestionTiles v-model="eatsOut" :items="eatsOutItems" :columns="3" />
      <p class="text-sm font-medium">{{ $t('budgetPlans.suggest.subscriptions.question') }}</p>
      <SuggestionTiles v-model="subscriptions" :items="subscriptionItems" :columns="3" />
    </template>

    <template v-else-if="step === 'focus'">
      <div>
        <p class="text-sm font-medium">
          {{
            $t(hasHistory ? 'budgetPlans.suggest.focus.questionHistory' : 'budgetPlans.suggest.focus.questionNoHistory')
          }}
        </p>
        <p class="text-muted-foreground text-xs">
          {{ $t(hasHistory ? 'budgetPlans.suggest.focus.hintHistory' : 'budgetPlans.suggest.focus.hintNoHistory') }}
        </p>
      </div>
      <SuggestionTiles v-model="focusCategoryIds" :items="focusItems" :columns="3" />
    </template>

    <template v-else>
      <p class="text-sm font-medium">{{ $t('budgetPlans.suggest.detail.question') }}</p>
      <SuggestionTiles v-model="detail" :items="detailItems" :columns="3" />
    </template>

    <div class="flex items-center gap-2">
      <Button type="button" variant="outline" :disabled="isSubmitting" @click="goBack">
        <ArrowLeftIcon class="size-4" />
        {{ $t('budgetPlans.suggest.back') }}
      </Button>
      <Button
        type="button"
        variant="link"
        class="ml-auto"
        :disabled="isSubmitting"
        @click="isDefaultsConfirmOpen = true"
      >
        {{ $t('budgetPlans.suggest.useDefaults') }}
      </Button>
      <Button type="button" :disabled="isSubmitting" :loading="isSubmitting" @click="goNext">
        <template v-if="!isLastStep">
          {{ $t('budgetPlans.suggest.next') }}
          <ArrowRightIcon class="size-4" />
        </template>
        <template v-else>{{ submitLabel }}</template>
      </Button>
    </div>

    <ResponsiveAlertDialog
      v-model:open="isDefaultsConfirmOpen"
      :confirm-label="$t('budgetPlans.suggest.useDefaults')"
      :cancel-label="$t('budgetPlans.suggest.defaultsConfirm.cancel')"
      @confirm="emit('submit')"
    >
      <template #title>{{ $t('budgetPlans.suggest.defaultsConfirm.title') }}</template>
      <template #description>{{ $t('budgetPlans.suggest.defaultsConfirm.description') }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>
