/** Coalesce rapid onDelta calls; flush at most once per `ms`, plus a final flush. */
export function createThrottledDelta(
  write: (transcript: string) => void | Promise<void>,
  ms = 500,
  onError?: (error: unknown) => void,
): {
  onDelta: (transcript: string) => Promise<void>;
  flush: () => Promise<void>;
} {
  let pending: string | null = null;
  let lastWrite = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  // A failed partial write must not poison later writes or the run itself:
  // the final transcript is persisted once the harness finishes.
  const doWrite = (text: string) => {
    chain = chain
      .then(() => write(text))
      .catch((error: unknown) => {
        onError?.(error);
      });
    return chain;
  };

  const onDelta = async (transcript: string) => {
    pending = transcript;
    const now = Date.now();
    const elapsed = now - lastWrite;
    if (elapsed >= ms) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastWrite = now;
      const text = pending;
      pending = null;
      await doWrite(text);
      return;
    }
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        if (pending == null) return;
        const text = pending;
        pending = null;
        lastWrite = Date.now();
        void doWrite(text);
      }, ms - elapsed);
    }
  };

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending != null) {
      const text = pending;
      pending = null;
      lastWrite = Date.now();
      await doWrite(text);
    }
    await chain;
  };

  return { onDelta, flush };
}
