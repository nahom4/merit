/** Identifiers are injected for the same reason time is: a test must be able to predict them. */
export interface IdGenerator {
  next(): string;
}
