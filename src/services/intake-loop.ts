import type { IntakePassResult } from "./intake.js";

export type IntakeLoopOptions = {
  intervalMs: number;
  runPass: () => Promise<IntakePassResult>;
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
      if (result.started > 0 || result.repaired > 0) {
        console.log(
          `intake: started=${result.started} repaired=${result.repaired}`,
        );
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
