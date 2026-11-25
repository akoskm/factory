import type { IntakePassResult } from "./intake.js";
import type { DispatcherPassResult } from "./queue-dispatcher.js";

export type IntakeLoopOptions = {
  intervalMs: number;
  runPass: () => Promise<IntakePassResult>;
  runDispatch?: () => Promise<DispatcherPassResult>;
  /** Drop needs_user holds whose GitHub issue is already closed. */
  abandonClosedHolds?: () => Promise<number>;
  onError?: (err: unknown) => void;
};

export type IntakeLoop = {
  start(): void;
  stop(): void;
};

export function createIntakeLoop(options: IntakeLoopOptions): IntakeLoop {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  async function tick() {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await options.runPass();
      if (result.listed > 0 || result.repaired > 0) {
        console.log(
          `intake: listed=${result.listed} repaired=${result.repaired}`,
        );
      }
      if (options.abandonClosedHolds) {
        const abandoned = await options.abandonClosedHolds();
        if (abandoned > 0) {
          console.log(`intake: abandoned closed-issue holds=${abandoned}`);
        }
      }
      if (options.runDispatch) {
        const dispatch = await options.runDispatch();
        if (dispatch.promoted > 0 || dispatch.started > 0) {
          console.log(
            `queue: promoted=${dispatch.promoted} started=${dispatch.started}`,
          );
        }
      }
    } catch (err) {
      (options.onError ?? console.error)(err);
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, options.intervalMs);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
