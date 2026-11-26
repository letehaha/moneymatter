<template>
  <div v-if="isPaid" class="plate gift-done" role="status">
    <span class="itile"
      ><svg aria-hidden="true" class="ic"><use href="#r-check" /></svg
    ></span>
    <h2>{{ tr({ text: 'Payment received' }) }}</h2>
    <p>
      {{
        tr({
          text: "We'll email the gift code to the recipient, right away or on the date you chose. You'll get a confirmation email too.",
        })
      }}
    </p>
    <a class="btn btn-quiet" :href="pagePath">{{ tr({ text: 'Send another gift' }) }}</a>
  </div>

  <form v-else class="plate gift-form" @submit.prevent="submit">
    <fieldset class="gift-plans">
      <legend>{{ tr({ text: 'Choose a plan' }) }}</legend>
      <label v-for="plan in GIFT_PLANS" :key="plan.id" class="gift-plan" :class="{ 'gift-plan-on': tier === plan.id }">
        <input v-model="tier" type="radio" name="tier" :value="plan.id" />
        <span class="gift-plan-top">
          <strong>{{ tr({ text: plan.name }) }}</strong>
          <span v-if="plan.highlight" class="tier-tag">{{ tr({ text: 'Popular' }) }}</span>
        </span>
        <span class="gift-plan-price">
          <b>${{ plan.yearly }}</b> {{ tr({ text: 'for 12 months' }) }}
        </span>
        <span class="gift-plan-desc">{{ tr({ text: plan.tagline }) }}</span>
      </label>
    </fieldset>

    <div class="gift-fields">
      <label class="gift-field">
        <span>{{ tr({ text: 'Your name' }) }}</span>
        <input v-model.trim="buyerName" type="text" required :pattern="NON_BLANK" maxlength="100" autocomplete="name" />
      </label>
      <label class="gift-field">
        <span>{{ tr({ text: 'Your email' }) }}</span>
        <input v-model="buyerEmail" type="email" required maxlength="320" autocomplete="email" />
      </label>
      <label class="gift-field">
        <span>{{ tr({ text: "Recipient's name" }) }}</span>
        <input
          v-model.trim="recipientName"
          type="text"
          required
          :pattern="NON_BLANK"
          maxlength="100"
          autocomplete="off"
        />
      </label>
      <label class="gift-field">
        <span>{{ tr({ text: "Recipient's email" }) }}</span>
        <input v-model="recipientEmail" type="email" required maxlength="320" autocomplete="off" />
      </label>
    </div>

    <label class="gift-field">
      <span class="gift-field-row">
        {{ tr({ text: 'Message (optional)' }) }}
        <small id="gift-message-count">{{ message.length }}/{{ MESSAGE_MAX_LENGTH }}</small>
      </span>
      <textarea v-model="message" rows="4" :maxlength="MESSAGE_MAX_LENGTH" aria-describedby="gift-message-count" />
    </label>

    <div class="gift-schedule">
      <label class="gift-check">
        <input v-model="isScheduled" type="checkbox" />
        {{ tr({ text: 'Send on a specific date' }) }}
      </label>
      <label v-if="isScheduled" class="gift-field">
        <span>{{ tr({ text: 'Delivery date' }) }}</span>
        <input v-model="deliveryDate" type="date" required :min="minDate" :max="maxDate" />
      </label>
      <p class="gift-hint">
        {{
          tr({
            text: isScheduled
              ? 'We email the gift at 9:00 your time on that day.'
              : 'Without a date, we email the gift right after payment.',
          })
        }}
      </p>
    </div>

    <p v-if="error" id="gift-error" class="gift-error" role="alert">{{ error }}</p>

    <button type="submit" class="btn btn-primary btn-lg" :disabled="isLoading">
      {{ tr({ text: isLoading ? 'Opening checkout…' : 'Continue to payment' }) }}
    </button>
    <p class="gift-hint">{{ tr({ text: 'Price before tax. Promo codes can be applied at checkout.' }) }}</p>
  </form>
</template>

<script setup lang="ts">
import { startGiftCheckout, type GiftCheckoutBody } from '@/lib/gift-checkout';
import { GIFT_PLANS } from '@/lib/plans';
import { onMounted, ref } from 'vue';

const MESSAGE_MAX_LENGTH = 500;
const NON_BLANK = '.*\\S.*';
const DELIVERY_HOUR = 9;
// One day short of the API's 365-day cap: 09:00 on day 365 lands past it whenever the buyer submits before 09:00.
const MAX_DELIVERY_DAYS = 364;

const props = defineProps<{ dict?: Record<string, string> }>();
const tr = ({ text }: { text: string }) => props.dict?.[text] ?? text;

const tier = ref<GiftCheckoutBody['tier']>('plus');
const buyerName = ref('');
const buyerEmail = ref('');
const recipientName = ref('');
const recipientEmail = ref('');
const message = ref('');
const isScheduled = ref(false);
const deliveryDate = ref('');
const minDate = ref('');
const maxDate = ref('');
const pagePath = ref('');
const isPaid = ref(false);
const isLoading = ref(false);
const error = ref('');

const toDateInputValue = ({ date }: { date: Date }) =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0')).join('-');

// A local date-time string without an offset parses in the browser's timezone.
const toDeliverAt = () => {
  if (!isScheduled.value || !deliveryDate.value) return undefined;
  const instant = new Date(`${deliveryDate.value}T${String(DELIVERY_HOUR).padStart(2, '0')}:00`);
  return instant.getTime() > Date.now() ? instant.toISOString() : undefined;
};

onMounted(() => {
  // Today is the unticked "send now" case, and its 09:00 may already be past.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const last = new Date();
  last.setDate(last.getDate() + MAX_DELIVERY_DAYS);
  minDate.value = toDateInputValue({ date: tomorrow });
  maxDate.value = toDateInputValue({ date: last });
  pagePath.value = window.location.pathname;
  isPaid.value = new URLSearchParams(window.location.search).get('status') === 'success';

  // Back from Stripe restores the page from bfcache with the button still disabled.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) isLoading.value = false;
  });
});

async function submit() {
  if (isLoading.value) return;

  error.value = '';
  isLoading.value = true;

  const result = await startGiftCheckout({
    body: {
      tier: tier.value,
      buyerName: buyerName.value.trim(),
      buyerEmail: buyerEmail.value.trim(),
      recipientName: recipientName.value.trim(),
      recipientEmail: recipientEmail.value.trim(),
      message: message.value.trim() || undefined,
      deliverAt: toDeliverAt(),
      returnPath: pagePath.value.replace(/\/+$/, ''),
    },
  });

  if ('url' in result) {
    window.location.href = result.url;
    return;
  }

  error.value = tr({ text: result.error });
  isLoading.value = false;
}
</script>
