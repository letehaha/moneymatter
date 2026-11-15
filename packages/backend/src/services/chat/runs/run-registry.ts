/** Why a local run was aborted. */
export type RunAbortReason = 'cancelled' | 'shutdown' | 'timeout';

const controllers = new Map<string, AbortController>();

/** Runs executing in this process, so a cancel that lands here stops them at once. */
export const registerLocalRun = ({ runId, controller }: { runId: string; controller: AbortController }): void => {
  controllers.set(runId, controller);
};

export const unregisterLocalRun = ({ runId }: { runId: string }): void => {
  controllers.delete(runId);
};

export const abortLocalRun = ({ runId, reason }: { runId: string; reason: RunAbortReason }): boolean => {
  const controller = controllers.get(runId);
  if (!controller || controller.signal.aborted) return false;

  controller.abort(reason);
  return true;
};

export const abortAllLocalRuns = ({ reason }: { reason: RunAbortReason }): void => {
  for (const controller of controllers.values()) {
    if (!controller.signal.aborted) controller.abort(reason);
  }
};
