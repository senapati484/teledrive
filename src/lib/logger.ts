/**
 * Lightweight environment-aware logger.
 *
 * In production builds (`import.meta.env.PROD`), `debug`, `log`, `info`, and
 * `warn` are silenced to keep the runtime console clean and avoid unnecessary
 * string formatting/IPC overhead. `error` is always forwarded so crash
 * diagnostics remain visible.
 */

function isDevEnv(): boolean {
  return Boolean(import.meta.env?.DEV);
}

/* eslint-disable no-console */
export const logger = {
  /** Debug-level output — silenced in production. */
  debug(...args: unknown[]): void {
    if (isDevEnv()) {
      console.debug(...args);
    }
  },
  /** Info-level output — silenced in production. */
  log(...args: unknown[]): void {
    if (isDevEnv()) {
      console.log(...args);
    }
  },
  /** Info-level alias — silenced in production. */
  info(...args: unknown[]): void {
    if (isDevEnv()) {
      console.info(...args);
    }
  },
  /** Warning — silenced in production. */
  warn(...args: unknown[]): void {
    if (isDevEnv()) {
      console.warn(...args);
    }
  },
  /** Error — always forwarded for crash diagnostics. */
  error(...args: unknown[]): void {
    console.error(...args);
  },
};
/* eslint-enable no-console */
