import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BmfSchemaChanged, splitCsvLine, streamRegistry } from './bmf-loader.js';

/** The header the live BMF returns, in the order the appendix records it. */
const HEADER = 'EIN,NAME,CITY,STATE,ZIP,SUBSECTION,REVENUE_AMT,NTEE_CD';

const directory = mkdtempSync(join(tmpdir(), 'merit-bmf-'));

const registryFile = (contents: string): string => {
  const path = join(directory, `bmf-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(path, contents, 'utf8');
  return path;
};

const stream = async (contents: string) => {
  const rows = [];
  for await (const entity of streamRegistry(registryFile(contents))) rows.push(entity);
  return rows;
};

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('streamRegistry — exempt status', () => {
  it('reads the subsection the 501(c)(3) eligibility check decides on', async () => {
    const rows = await stream(
      `${HEADER}\n581613254,CAPE FEAR LITERACY COUNCIL,WILMINGTON,NC,28401,03,656000,B60\n`,
    );

    expect(rows[0]?.subsectionCode).toBe(3);
  });

  it('reads a registry row with no subsection as not stated, never as not a charity', async () => {
    const rows = await stream(
      `${HEADER}\n581613254,CAPE FEAR LITERACY COUNCIL,WILMINGTON,NC,28401,,656000,B60\n`,
    );

    expect(rows[0]?.subsectionCode).toBeNull();
  });

  it('raises when the registry stops carrying the column rather than loading everything as unknown', async () => {
    const withoutSubsection =
      'EIN,NAME,CITY,STATE,ZIP,REVENUE_AMT,NTEE_CD\n123456789,A CHARITY,WILMINGTON,NC,28401,1000,B60\n';

    await expect(stream(withoutSubsection)).rejects.toThrow(BmfSchemaChanged);
  });
});

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
