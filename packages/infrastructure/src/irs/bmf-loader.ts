import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { blockingKey, normalizeName } from '@merit/domain';

/**
 * One row of the IRS Exempt Organizations Business Master File: the canonical record of
 * every registered US nonprofit, and the target set every recipient string is linked against.
 *
 * Clustering recipient strings against each other is the obvious approach and the wrong one.
 * It is unbounded, hard to measure, and produces clusters with no program code, no budget,
 * and no address -- nothing the prospect scoring can use. Linking against a known registry
 * turns it into record linkage, and a linked record inherits exactly the fields scoring needs.
 */
export interface RegistryEntity {
  readonly ein: string;
  readonly canonicalName: string;
  readonly normalizedName: string;
  readonly nteeCode: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  readonly revenueCents: number | null;
  readonly blockingKey: string | null;
}

/** The header the BMF actually returns, verified live. Column order is not assumed. */
const REQUIRED_COLUMNS = ['EIN', 'NAME', 'CITY', 'STATE', 'ZIP', 'REVENUE_AMT', 'NTEE_CD'] as const;

const RowSchema = z.object({
  EIN: z.string().regex(/^\d{1,9}$/),
  NAME: z.string().min(1),
  CITY: z.string(),
  STATE: z.string(),
  ZIP: z.string(),
  REVENUE_AMT: z.string(),
  NTEE_CD: z.string(),
});

export class BmfSchemaChanged extends Error {}

/**
 * Streams a BMF regional file. The four files together are ~340MB and 1.8M rows, so nothing
 * is held in memory beyond the current row.
 */
export async function* streamRegistry(csvPath: string): AsyncGenerator<RegistryEntity> {
  const lines = createInterface({
    input: createReadStream(csvPath, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  let columns: string[] | null = null;

  for await (const line of lines) {
    if (line.trim().length === 0) continue;

    const fields = splitCsvLine(line);

    if (columns === null) {
      columns = fields.map((field) => field.trim().toUpperCase());
      const missing = REQUIRED_COLUMNS.filter((name) => !columns!.includes(name));
      if (missing.length > 0) {
        // The registry is not ours and its header can drift. Guessing at column positions
        // would silently load the wrong field into every entity.
        throw new BmfSchemaChanged(`BMF header is missing ${missing.join(', ')}`);
      }
      continue;
    }

    const record: Record<string, string> = {};
    columns.forEach((name, index) => {
      record[name] = fields[index] ?? '';
    });

    const parsed = RowSchema.safeParse(record);
    if (!parsed.success) continue;

    const entity = toEntity(parsed.data);
    if (entity !== null) yield entity;
  }
}

const toEntity = (row: z.infer<typeof RowSchema>): RegistryEntity | null => {
  // Spreadsheet handling of the BMF drops leading zeros; the EIN is padded back to nine.
  const ein = row.EIN.padStart(9, '0');
  if (ein === '000000000') return null;

  const canonicalName = row.NAME.trim();
  const normalizedName = normalizeName(canonicalName);
  if (normalizedName.length === 0) return null;

  const state = row.STATE.trim().toUpperCase();
  const revenue = Number(row.REVENUE_AMT.trim());

  return {
    ein,
    canonicalName,
    normalizedName,
    nteeCode: row.NTEE_CD.trim().length === 0 ? null : row.NTEE_CD.trim().toUpperCase(),
    city: row.CITY.trim().length === 0 ? null : row.CITY.trim().toUpperCase(),
    state: state.length === 0 ? null : state,
    // The BMF prints ZIP+4; the five-digit prefix is what filings agree on.
    zip: row.ZIP.trim().length === 0 ? null : row.ZIP.trim().slice(0, 5),
    revenueCents: Number.isFinite(revenue) && revenue > 0 ? Math.round(revenue * 100) : null,
    blockingKey: state.length === 0 ? null : blockingKey(normalizedName, state),
  };
};

/** The BMF is a plain comma-separated file, but organisation names contain quoted commas. */
export const splitCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
};
