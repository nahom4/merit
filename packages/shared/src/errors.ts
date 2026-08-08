/**
 * `new Error('failed')` is never acceptable (docs/conventions.md). Every error names
 * itself, carries a stable code, and attaches the context needed to act on it.
 */
export type ErrorContext = Readonly<Record<string, string | number | boolean | null>>;

export abstract class DomainError extends Error {
  abstract readonly code: string;
  readonly context: ErrorContext;

  constructor(message: string, context: ErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.context = context;
  }

  toJSON(): { name: string; code: string; message: string; context: ErrorContext } {
    return { name: this.name, code: this.code, message: this.message, context: this.context };
  }
}

/** An external byte sequence did not match the schema it claimed to satisfy. */
export class ParseError extends DomainError {
  readonly code = 'parse_error';
}

/** A record that must exist does not. Expected -- callers handle it, they do not crash. */
export class NotFoundError extends DomainError {
  readonly code = 'not_found';
}

/**
 * A 990 schema version we have never seen. Thrown, never returned: guessing at unseen
 * structure loses data silently, which is the worst failure mode this system has.
 */
export class UnknownSchemaVersion extends DomainError {
  readonly code = 'unknown_schema_version';
}
