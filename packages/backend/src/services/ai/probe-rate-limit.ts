// The budget of live provider probes per user, spent by the connection routes (through their middleware)
// and by a model pick that has to fall back to a probe. One key keeps the two from adding up.

export const AI_PROBE_RATE_LIMIT_WINDOW_SECONDS = 60;
export const AI_PROBE_RATE_LIMIT_MAX_ATTEMPTS = 15;

export const aiProbeRateLimitKey = ({ userId }: { userId: number }): string => `ai-connection-probe:user:${userId}`;
