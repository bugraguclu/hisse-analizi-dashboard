export type StartupState = "idle" | "running" | "succeeded" | "failed";

export interface StartupRun {
  generation: number;
  promise: Promise<void>;
}

export type StartupObservation =
  | { kind: "success"; generation: number }
  | { kind: "failure"; generation: number; error: unknown }
  | { kind: "timeout"; generation: number };

/**
 * Owns the process-wide native startup attempt (adapted from TusAnkiM's `StartupCoordinator`).
 *
 * A UI timeout stops waiting and shows recovery UI, but never launches a second concurrent
 * local storage migration while the first attempt is still in flight. Only an explicit failure
 * allows `start()` to begin a new generation.
 */
export class StartupCoordinator {
  private current: StartupRun | null = null;
  private generation = 0;
  private currentState: StartupState = "idle";

  get state(): StartupState {
    return this.currentState;
  }

  get currentRun(): StartupRun | null {
    return this.current;
  }

  start(runCore: () => Promise<void>): StartupRun {
    if (this.current && (this.currentState === "running" || this.currentState === "succeeded")) {
      return this.current;
    }

    const generation = ++this.generation;
    this.currentState = "running";

    const promise = Promise.resolve()
      .then(runCore)
      .then(
        () => {
          if (this.current?.generation === generation) {
            this.currentState = "succeeded";
          }
        },
        (error) => {
          if (this.current?.generation === generation) {
            this.currentState = "failed";
          }
          throw error;
        },
      );

    this.current = { generation, promise };
    return this.current;
  }
}

/** Observe one startup attempt within a UI timeout budget without cancelling the underlying work. */
export function observeStartupRun(run: StartupRun, timeoutMs: number): Promise<StartupObservation> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StartupObservation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ kind: "timeout", generation: run.generation }),
      timeoutMs,
    );

    run.promise.then(
      () => finish({ kind: "success", generation: run.generation }),
      (error) => finish({ kind: "failure", generation: run.generation, error }),
    );
  });
}
