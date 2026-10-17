export const FAN_OUT_JOB = 'fan-out';
export const DELIVER_JOB = 'deliver';

const DELIVER_ATTEMPTS = 5;
const FAN_OUT_ATTEMPTS = 3;

// The delay before a failed attempt is retried. It is zero under test, where BullMQ puts a
// zero-delay retry straight back on the waiting list instead of the delayed set. The delivery
// e2e relies on that order: a retry has to run before a job queued after the failure.
const RETRY_BACKOFF_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;

const backoff = () => ({ type: 'exponential' as const, delay: RETRY_BACKOFF_MS });

export const fanOutJobOptions = ({ notificationId }: { notificationId: string }) => ({
  jobId: `push-fanout-${notificationId}`,
  attempts: FAN_OUT_ATTEMPTS,
  backoff: backoff(),
});

export const deliverJobOptions = ({
  notificationId,
  subscriptionId,
}: {
  notificationId: string;
  subscriptionId: string;
}) => ({
  jobId: `push-${notificationId}-${subscriptionId}`,
  attempts: DELIVER_ATTEMPTS,
  backoff: backoff(),
});
