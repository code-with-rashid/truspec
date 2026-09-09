import type { Server } from "node:http";

/**
 * How long an in-flight response gets to finish before open sockets are destroyed outright.
 * Long enough for a real handler to complete, short enough that a stuck one can't hang a shutdown.
 */
export const CLOSE_GRACE_MS = 1000;

/** How often, during the grace period, to retire sockets that have since gone idle. */
const SWEEP_MS = 25;

/**
 * Shut an HTTP server down so that the returned promise is *guaranteed* to settle.
 *
 * `server.close()` on its own is not: it stops accepting new connections and sweeps sockets that
 * are idle *at that moment*, but it then waits forever on any socket that is connected without
 * having sent a request. Browsers open exactly those speculatively — Chromium preconnects — so one
 * open tab is enough to make `close()` never resolve. That is not theoretical: it hung the mock
 * server's stop button, and it timed out the e2e fixture teardown in CI.
 *
 * The single sweep is also why a socket that parks *after* close() (its response having just
 * finished) would otherwise hold shutdown open for the whole grace period, so keep sweeping.
 *
 * Net effect: stop accepting work, retire idle sockets as they fall idle, give anything genuinely
 * in flight a grace period to finish, then destroy whatever is still holding on.
 */
export function closeHttpServer(server: Server, graceMs: number = CLOSE_GRACE_MS): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let sweep: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    server.close((e) => {
      settled = true;
      if (sweep) clearInterval(sweep);
      if (deadline) clearTimeout(deadline);
      // Already closed is the state the caller asked for, not a failure.
      if (e && (e as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(e);
      else resolve();
    });
    server.closeIdleConnections();
    // A server that was already closed calls back before there is anything to schedule.
    if (settled) return;

    sweep = setInterval(() => server.closeIdleConnections(), SWEEP_MS);
    deadline = setTimeout(() => server.closeAllConnections(), graceMs);
    // Never let shutdown timers alone keep the process alive.
    sweep.unref();
    deadline.unref();
  });
}
