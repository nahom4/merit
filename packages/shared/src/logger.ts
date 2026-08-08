import type { ErrorContext } from './errors.js';

/**
 * The logger contract. Every error crossing a boundary is logged once, at the boundary,
 * with a correlation id -- not at every level on the way up (docs/conventions.md).
 */
export interface Logger {
  info(message: string, context?: ErrorContext): void;
  warn(message: string, context?: ErrorContext): void;
  error(message: string, context?: ErrorContext): void;
}

export const consoleLogger: Logger = {
  info: (message, context) => console.log(JSON.stringify({ level: 'info', message, ...context })),
  warn: (message, context) => console.warn(JSON.stringify({ level: 'warn', message, ...context })),
  error: (message, context) => console.error(JSON.stringify({ level: 'error', message, ...context })),
};

/** For tests that assert on behaviour rather than on log noise. */
export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
