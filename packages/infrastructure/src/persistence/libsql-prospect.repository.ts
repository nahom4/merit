import { err, ok, type Result } from '@merit/shared';
import type { GranteeGrant } from '@merit/domain';
import { RepositoryUnavailable } from '@merit/application';
import type {
  CandidateFunder,
  FunderGrantHistory,
  PeerEntity,
  PeerGranteeEvidence,
  PeerQuery,
  ProspectRepository,
} from '@merit/application';
import type { Database } from './database.js';

/** SQLite has a bound on host parameters; large id lists go in as chunks. */
const PARAM_CHUNK = 400;

export class LibsqlProspectRepository implements ProspectRepository {
  constructor(private readonly db: Database) {}

  /**
   * Peers are organisations of comparable size in the same program area that a funder has
   * actually given to. "Comparable by who funds them, rather than by how they describe
   * themselves" is the point -- so the peer set is drawn from the graph, not the registry
   * alone: an entity nobody has ever funded tells us nothing about who might fund us.
   */
  async findPeers(query: PeerQuery): Promise<Result<readonly PeerEntity[], RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: `SELECT e.ein, e.canonical_name, e.state, e.ntee_code, e.revenue_cents
              FROM entities e
              WHERE substr(e.ntee_code, 1, 1) = ?
                AND e.ein <> ?
                AND e.revenue_cents IS NOT NULL
                AND e.revenue_cents BETWEEN ? AND ?
                AND EXISTS (
                  SELECT 1 FROM entity_links l
                  WHERE l.entity_ein = e.ein AND l.decision = 'linked'
                )
              LIMIT 5000`,
        args: [query.nteeMajorGroup, query.excludeEin, query.minRevenueCents, query.maxRevenueCents],
      });

      return ok(
        result.rows.map((row) => ({
          ein: String(row['ein']),
          name: String(row['canonical_name']),
          state: row['state'] === null ? null : String(row['state']),
          nteeCode: row['ntee_code'] === null ? null : String(row['ntee_code']),
          revenueCents: row['revenue_cents'] === null ? null : Number(row['revenue_cents']),
        })),
      );
    } catch (cause) {
      return err(unavailable('findPeers', cause));
    }
  }

  /** Every funder of every peer, with the count of distinct peers and in-region peers. */
  async findCandidateFunders(
    peerEins: readonly string[],
    region: readonly string[],
    limit: number,
  ): Promise<Result<readonly CandidateFunder[], RepositoryUnavailable>> {
    if (peerEins.length === 0) return ok([]);
    try {
      const tallies = new Map<
        string,
        { name: string; state: string | null; peers: Set<string>; regional: Set<string> }
      >();

      for (const chunk of chunks(peerEins, PARAM_CHUNK)) {
        const result = await this.db.execute({
          sql: `SELECT g.funder_ein, f.name AS funder_name, f.state AS funder_state,
                       l.entity_ein, e.state AS grantee_state
                FROM entity_links l
                JOIN grant_records g ON g.id = l.grant_record_id
                JOIN funders f ON f.ein = g.funder_ein
                LEFT JOIN entities e ON e.ein = l.entity_ein
                WHERE l.decision = 'linked'
                  AND l.entity_ein IN (${chunk.map(() => '?').join(',')})`,
          args: [...chunk],
        });

        for (const row of result.rows) {
          const ein = String(row['funder_ein']);
          const tally = tallies.get(ein) ?? {
            name: String(row['funder_name'] ?? ''),
            state: row['funder_state'] === null ? null : String(row['funder_state']),
            peers: new Set<string>(),
            regional: new Set<string>(),
          };
          const granteeEin = String(row['entity_ein']);
          tally.peers.add(granteeEin);
          const granteeState = row['grantee_state'] === null ? null : String(row['grantee_state']);
          if (granteeState !== null && region.includes(granteeState)) tally.regional.add(granteeEin);
          tallies.set(ein, tally);
        }
      }

      const ranked = [...tallies.entries()]
        .sort((a, b) => {
          const regional = b[1].regional.size - a[1].regional.size;
          return regional !== 0 ? regional : b[1].peers.size - a[1].peers.size;
        })
        .slice(0, limit);

      const candidates: CandidateFunder[] = [];
      for (const [ein, tally] of ranked) {
        const evidence = await this.evidenceFor(ein, [...tally.peers]);
        if (!evidence.ok) return evidence;
        candidates.push({
          ein,
          name: tally.name,
          state: tally.state,
          peerGranteeCount: tally.peers.size,
          regionalGranteeCount: tally.regional.size,
          peerGrantees: evidence.value,
        });
      }
      return ok(candidates);
    } catch (cause) {
      return err(unavailable('findCandidateFunders', cause));
    }
  }

  /** The rows a development director opens to check the call rather than trust it. */
  private async evidenceFor(
    funderEin: string,
    peerEins: readonly string[],
  ): Promise<Result<readonly PeerGranteeEvidence[], RepositoryUnavailable>> {
    try {
      const chunk = peerEins.slice(0, PARAM_CHUNK);
      const result = await this.db.execute({
        sql: `SELECT l.entity_ein, e.canonical_name, e.city, e.state,
                     g.tax_year, g.amount_cents, g.purpose
              FROM entity_links l
              JOIN grant_records g ON g.id = l.grant_record_id
              LEFT JOIN entities e ON e.ein = l.entity_ein
              WHERE g.funder_ein = ? AND l.decision = 'linked'
                AND l.entity_ein IN (${chunk.map(() => '?').join(',')})
              ORDER BY g.amount_cents DESC
              LIMIT 25`,
        args: [funderEin, ...chunk],
      });

      return ok(
        result.rows.map((row) => ({
          entityEin: String(row['entity_ein']),
          name: String(row['canonical_name'] ?? 'Unnamed organisation'),
          city: row['city'] === null ? null : String(row['city']),
          state: row['state'] === null ? null : String(row['state']),
          taxYear: Number(row['tax_year']),
          amountCents: Number(row['amount_cents']),
          purpose: row['purpose'] === null ? null : String(row['purpose']),
        })),
      );
    } catch (cause) {
      return err(unavailable('evidenceFor', cause));
    }
  }

  /**
   * A candidate funder's full grant history, which the behavioural signals are computed from.
   *
   * Unlinked recipients are kept: they still carry a year, an amount, and a state, so they
   * count toward turnover and the ask distribution. Excluding them would make every funder
   * look smaller and more open than it is. The grantee key falls back to the normalised name.
   */
  async loadFunderHistories(
    funderEins: readonly string[],
    nteeMajorGroup: string,
  ): Promise<Result<readonly FunderGrantHistory[], RepositoryUnavailable>> {
    if (funderEins.length === 0) return ok([]);
    try {
      const byFunder = new Map<string, GranteeGrant[]>();
      const programTally = new Map<string, { inGroup: Set<string>; resolved: Set<string> }>();

      for (const chunk of chunks(funderEins, PARAM_CHUNK)) {
        const result = await this.db.execute({
          sql: `SELECT g.funder_ein, g.tax_year, g.amount_cents, g.recipient_state, g.recipient_normalized,
                       l.entity_ein, l.decision, e.ntee_code
                FROM grant_records g
                LEFT JOIN entity_links l ON l.grant_record_id = g.id
                LEFT JOIN entities e ON e.ein = l.entity_ein
                WHERE g.funder_ein IN (${chunk.map(() => '?').join(',')})`,
          args: [...chunk],
        });

        for (const row of result.rows) {
          const funderEin = String(row['funder_ein']);
          const linked = String(row['decision'] ?? '') === 'linked';
          const entityEin = row['entity_ein'] === null ? null : String(row['entity_ein']);
          const granteeKey = linked && entityEin !== null ? entityEin : String(row['recipient_normalized']);

          const grants = byFunder.get(funderEin) ?? [];
          grants.push({
            granteeKey,
            taxYear: Number(row['tax_year']),
            amountCents: Number(row['amount_cents']),
            granteeState: row['recipient_state'] === null ? null : String(row['recipient_state']),
          });
          byFunder.set(funderEin, grants);

          if (linked && entityEin !== null) {
            const tally = programTally.get(funderEin) ?? { inGroup: new Set(), resolved: new Set() };
            tally.resolved.add(entityEin);
            const ntee = row['ntee_code'] === null ? null : String(row['ntee_code']);
            if (ntee !== null && ntee.startsWith(nteeMajorGroup)) tally.inGroup.add(entityEin);
            programTally.set(funderEin, tally);
          }
        }
      }

      return ok(
        [...byFunder.entries()].map(([funderEin, grants]) => {
          const tally = programTally.get(funderEin);
          return {
            funderEin,
            grants,
            sameProgramGranteeShare:
              tally === undefined || tally.resolved.size === 0 ? 0 : tally.inGroup.size / tally.resolved.size,
          };
        }),
      );
    } catch (cause) {
      return err(unavailable('loadFunderHistories', cause));
    }
  }
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
};

const unavailable = (operation: string, cause: unknown): RepositoryUnavailable =>
  new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
    operation,
    table: 'grant_records',
  });
