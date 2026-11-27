import { drainQueue, queueDepth } from './queue';

/**
 * Flush buffered events when the process is asked to stop.
 *
 * Events sit in memory for up to two seconds before they are written (see
 * lib/queue.ts). Without this, every redeploy or restart silently discarded
 * whatever had arrived in that window.
 *
 * Who exits the process matters here. By default Next.js installs its own
 * SIGTERM/SIGINT handler that closes the HTTP server and calls process.exit()
 * within milliseconds, long before a database write can finish (measured: about
 * 15 ms, with every buffered event lost). Setting NEXT_MANUAL_SIG_HANDLE=true
 * tells Next not to install it, and this module then flushes and exits itself.
 * The Dockerfile sets the variable. When it is missing there is no way to flush
 * reliably, so this module says so in the log instead of pretending to try.
 */

/** Docker stops a container with SIGTERM and sends SIGKILL after 10s. */
const GRACE_MS = 8_000;

/**
 * Requests already in flight when the signal arrives can still enqueue an event
 * a moment later, so wait briefly and flush a second time.
 */
const SETTLE_MS = 300;

/** The conventional 128 + signal number, which Next also uses. */
const EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

type ShutdownSignal = keyof typeof EXIT_CODES;

// Kept on globalThis for the same reason as the queue: instrumentation is
// bundled separately from the routes, and a hot reload re-evaluates modules.
const globalHooks = globalThis as typeof globalThis & { __analyticsShutdownHooked?: boolean };

export function registerShutdownHooks(): void {
  if (globalHooks.__analyticsShutdownHooked) return;
  globalHooks.__analyticsShutdownHooked = true;

  if (!process.env.NEXT_MANUAL_SIG_HANDLE) {
    // Serverless platforms have no SIGTERM to react to and README already says
    // the in-memory queue assumes a long-running process; stay quiet there.
    if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
      console.warn(
        'NEXT_MANUAL_SIG_HANDLE is not set: events still in the 2 second write buffer ' +
          'will be lost when this process stops. Set NEXT_MANUAL_SIG_HANDLE=true ' +
          '(the Dockerfile already does).'
      );
    }
    return;
  }

  for (const signal of Object.keys(EXIT_CODES) as ShutdownSignal[]) {
    // `once`: a second signal falls through to the default action, so pressing
    // Ctrl-C twice still force-quits.
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
}

async function shutdown(signal: ShutdownSignal): Promise<void> {
  console.log(`${signal} received: flushing ${queueDepth()} buffered event(s)`);

  const watchdog = setTimeout(() => {
    console.error(`Event flush did not finish within ${GRACE_MS} ms; giving up.`);
    process.exit(EXIT_CODES[signal]);
  }, GRACE_MS);

  try {
    await drainQueue();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    await drainQueue();
  } catch (err) {
    console.error('Flushing events on shutdown failed:', err);
  } finally {
    clearTimeout(watchdog);
  }

  process.exit(EXIT_CODES[signal]);
}
