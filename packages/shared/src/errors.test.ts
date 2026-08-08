import { describe, expect, it } from 'vitest';
import { DomainError, ParseError } from './errors.js';

class NotFound extends DomainError {
  readonly code = 'not_found';
}

describe('DomainError', () => {
  it('names itself after its own class rather than "Error"', () => {
    expect(new NotFound('organization 7 is not in the registry').name).toBe('NotFound');
  });

  it('carries structured context alongside the message', () => {
    const error = new NotFound('organization not found', { organizationId: '7' });
    expect(error.context).toEqual({ organizationId: '7' });
  });

  it('exposes a stable machine-readable code', () => {
    expect(new NotFound('x').code).toBe('not_found');
  });

  it('serialises to a log-ready object including its code and context', () => {
    expect(new NotFound('missing', { organizationId: '7' }).toJSON()).toEqual({
      name: 'NotFound',
      code: 'not_found',
      message: 'missing',
      context: { organizationId: '7' },
    });
  });

  it('remains an instance of Error so it survives a catch', () => {
    expect(new NotFound('x')).toBeInstanceOf(Error);
  });
});

describe('ParseError', () => {
  it('records the field that failed and the value it saw', () => {
    const error = new ParseError('ein must be nine digits', { field: 'ein', received: '12-345' });
    expect(error.code).toBe('parse_error');
    expect(error.context).toEqual({ field: 'ein', received: '12-345' });
  });
});
