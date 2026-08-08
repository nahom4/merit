import { describe, expect, it } from 'vitest';
import { splitCsvLine } from './bmf-loader.js';

describe('splitCsvLine', () => {
  it('splits a plain row', () => {
    expect(splitCsvLine('000019818,PALMER SECOND BAPTIST CHURCH,,PALMER,MA')).toEqual([
      '000019818',
      'PALMER SECOND BAPTIST CHURCH',
      '',
      'PALMER',
      'MA',
    ]);
  });

  it('keeps a comma inside a quoted organisation name', () => {
    expect(splitCsvLine('123,"SMITH, JONES AND CO",NC')).toEqual(['123', 'SMITH, JONES AND CO', 'NC']);
  });

  it('keeps an escaped quote inside a name', () => {
    expect(splitCsvLine('123,"THE ""BIG"" FOUNDATION",NC')).toEqual(['123', 'THE "BIG" FOUNDATION', 'NC']);
  });

  it('preserves a trailing empty field', () => {
    expect(splitCsvLine('123,NAME,')).toEqual(['123', 'NAME', '']);
  });

  it('returns one field for a row with no separators', () => {
    expect(splitCsvLine('EIN')).toEqual(['EIN']);
  });
});
