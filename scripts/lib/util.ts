/** Small helpers shared by the bot state machines. */

/** Resolves after `ms`, or immediately if `signal` aborts first. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
