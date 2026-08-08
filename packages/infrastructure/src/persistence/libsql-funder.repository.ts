import { err, ok, type Result } from '@merit/shared';
import type { ReachabilityGrant, SharedFunderRow } from '@merit/domain';
import { RepositoryUnavailable } from '@merit/application';
import type { FunderProfile, FunderRepository } from '@merit/application';
import type { Database } from './database.js';

/** SQLite has a bound on host parameters; large id lists go in as chunks. */
const PARAM_CHUNK = 400;

export class LibsqlFunderRepository implements FunderRepository {
  constructor(private readonly db: Database) {}

  async findFunder(ein: string): Promise<Result<FunderProfile | null, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: `SELECT ein, name, state, source_forms, first_tax_year, last_tax_year
              FROM funders WHERE ein = ?`,
        args: [ein],
      });

      const row = result.rows[0];
      if (row === undefined) return ok(null);

      return ok({
        ein: String(row['ein']),
        name: String(row['name']),
        state: row['state'] === null ? null : String(row['state']),
        sourceForms: String(row['source_forms']),
        firstTaxYear: row['first_tax_year'] === null ? null : Number(row['first_tax_year']),
        lastTaxYear: row['last_tax_year'] === null ? null : Number(row['last_tax_year']),
      });
    } catch (cause) {
      return err(unavailable('findFunder', 'funders', cause));
    }
  }

  /**
   * Every grant the funder made, joined out to the registry where the recipient resolved.
   *
   * Unresolved recipients are kept and keyed on their normalised name, matching
   * `loadFunderHistories`: they carry a year, an amount, and usually a state, and dropping
   * them would make the funder look smaller and more open than its filings show.
   */
  async loadGranteeHistory(
    funderEin: string,
  ): Promise<Result<readonly ReachabilityGrant[], RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: `SELECT g.tax_year, g.amount_cents, g.irs_object_id, g.purpose,
                     g.recipient_name, g.recipient_normalized, g.recipient_state,
                     l.decision, l.entity_ein,
                     e.canonical_name, e.state AS entity_state, e.ntee_code, e.revenue_cents
              FROM grant_records g
              LEFT JOIN entity_links l ON l.grant_record_id = g.id
              LEFT JOIN entities e ON e.ein = l.entity_ein
              WHERE g.funder_ein = ?`,
        args: [funderEin],
      });

      return ok(
        result.rows.map((row): ReachabilityGrant => {
          const linked = String(row['decision'] ?? '') === 'linked';
          const entityEin = row['entity_ein'] === null ? null : String(row['entity_ein']);
          const nteeCode = row['ntee_code'] === null ? null : String(row['ntee_code']);

          return {
            granteeKey: linked && entityEin !== null ? entityEin : String(row['recipient_normalized']),
            // The registry's canonical name where we have one -- filings spell the same
            // organisation several ways, and the report is read by a human.
            granteeName:
              linked && row['canonical_name'] !== null
                ? String(row['canonical_name'])
                : String(row['recipient_name']),
            granteeState:
              row['entity_state'] !== null && linked
                ? String(row['entity_state'])
                : row['recipient_state'] === null
                  ? null
                  : String(row['recipient_state']),
            // Only the major group is load-bearing: the program mix groups on it.
            granteeNteeMajorGroup: linked && nteeCode !== null ? nteeCode.charAt(0) : null,
            granteeRevenueCents:
              linked && row['revenue_cents'] !== null ? Number(row['revenue_cents']) : null,
            taxYear: Number(row['tax_year']),
            amountCents: Number(row['amount_cents']),
            irsObjectId: String(row['irs_object_id']),
            purpose: row['purpose'] === null ? null : String(row['purpose']),
          };
        }),
      );
    } catch (cause) {
      return err(unavailable('loadGranteeHistory', 'grant_records', cause));
    }
  }

  /**
   * `peer ← intermediary funder → this funder's grantee`, three hops through the graph.
   *
   * Peers this funder gives to directly are excluded from the grantee side. That relationship
   * is direct evidence, already stated on the prospect list, and counting it again here would
   * dress a fact the user has seen as a second, weaker one.
   */
  async findSharedFunderPaths(
    funderEin: string,
    peerEins: readonly string[],
    limit: number,
  ): Promise<Result<readonly SharedFunderRow[], RepositoryUnavailable>> {
    if (peerEins.length === 0 || limit <= 0) return ok([]);

    try {
      const rows: SharedFunderRow[] = [];

      for (const chunk of chunks(peerEins, PARAM_CHUNK)) {
        if (rows.length >= limit) break;
        const placeholders = chunk.map(() => '?').join(',');

        const result = await this.db.execute({
          sql: `
            WITH our_grantees AS (
              SELECT DISTINCT l.entity_ein AS ein
              FROM grant_records g
              JOIN entity_links l ON l.grant_record_id = g.id AND l.decision = 'linked'
              WHERE g.funder_ein = ? AND l.entity_ein IS NOT NULL
                AND l.entity_ein NOT IN (${placeholders})
            ),
            peer_funders AS (
              SELECT DISTINCT g.funder_ein AS via_ein, l.entity_ein AS peer_ein
              FROM entity_links l
              JOIN grant_records g ON g.id = l.grant_record_id
              WHERE l.decision = 'linked'
                AND l.entity_ein IN (${placeholders})
                AND g.funder_ein <> ?
            )
            SELECT DISTINCT
              og.ein            AS grantee_ein,
              ge.canonical_name AS grantee_name,
              ge.state          AS grantee_state,
              pf.via_ein        AS via_ein,
              vf.name           AS via_name,
              pf.peer_ein       AS peer_ein,
              pe.canonical_name AS peer_name
            FROM peer_funders pf
            JOIN grant_records g2 ON g2.funder_ein = pf.via_ein
            JOIN entity_links l2 ON l2.grant_record_id = g2.id AND l2.decision = 'linked'
            JOIN our_grantees og ON og.ein = l2.entity_ein
            JOIN funders vf ON vf.ein = pf.via_ein
            LEFT JOIN entities ge ON ge.ein = og.ein
            LEFT JOIN entities pe ON pe.ein = pf.peer_ein
            LIMIT ?`,
          args: [funderEin, ...chunk, ...chunk, funderEin, limit - rows.length],
        });

        for (const row of result.rows) {
          rows.push({
            granteeEin: String(row['grantee_ein']),
            granteeName: String(row['grantee_name'] ?? 'Unnamed organisation'),
            granteeState: row['grantee_state'] === null ? null : String(row['grantee_state']),
            viaFunderEin: String(row['via_ein']),
            viaFunderName: String(row['via_name'] ?? 'Unnamed funder'),
            peerEin: String(row['peer_ein']),
            peerName: String(row['peer_name'] ?? 'Unnamed organisation'),
          });
        }
      }

      return ok(rows.slice(0, limit));
    } catch (cause) {
      return err(unavailable('findSharedFunderPaths', 'entity_links', cause));
    }
  }
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
};

const unavailable = (operation: string, table: string, cause: unknown): RepositoryUnavailable =>
  new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
    operation,
    table,
  });
