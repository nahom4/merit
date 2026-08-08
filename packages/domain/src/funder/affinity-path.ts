/**
 * Shared-funder proximity: the funder under report gives to organisations that are also
 * funded by funders who give to our peers.
 *
 * This is a path through the bipartite funder–grantee graph in public filings and nothing
 * more. The product rules are explicit that it must be labelled as exactly that and never
 * dressed up as a personal connection, so the label and the denial are part of the value
 * rather than something the UI is trusted to remember to add.
 */

/** One `peer ← intermediary funder → this funder's grantee` edge, as the repository returns it. */
export interface SharedFunderRow {
  readonly granteeEin: string;
  readonly granteeName: string;
  readonly granteeState: string | null;
  /** A funder that gives both to the grantee and to one of our peers. */
  readonly viaFunderEin: string;
  readonly viaFunderName: string;
  readonly peerEin: string;
  readonly peerName: string;
}

export interface ConnectedPeer {
  readonly ein: string;
  readonly name: string;
}

export interface IntermediaryFunder {
  readonly funderEin: string;
  readonly funderName: string;
  readonly peers: readonly ConnectedPeer[];
}

export interface AffinityPath {
  readonly granteeEin: string;
  readonly granteeName: string;
  readonly granteeState: string | null;
  readonly via: readonly IntermediaryFunder[];
  /** 0–1, saturating. More shared funders is stronger evidence, up to a point. */
  readonly strength: number;
}

export interface AffinityPaths {
  readonly paths: readonly AffinityPath[];
  readonly distinctIntermediaryFunders: number;
  readonly label: string;
  readonly disclaimer: string;
}

export const AFFINITY_PATH_LABEL = 'shared-funder proximity';

/**
 * Shown wherever paths are shown. The wording avoids every word that would imply a person:
 * this is an overlap between two lists of EINs in public filings.
 */
export const AFFINITY_PATH_DISCLAIMER =
  'This is shared-funder proximity computed from public filings: the same funders appear on ' +
  'both sides. It is not a personal connection, and it says nothing about who has met whom.';

/**
 * Beyond three shared funders the evidence stops improving -- a fourth overlapping funder does
 * not make the pattern meaningfully more real than the third did.
 */
const INTERMEDIARY_SATURATION = 3;

export const buildAffinityPaths = (rows: readonly SharedFunderRow[]): AffinityPaths => {
  const byGrantee = new Map<
    string,
    {
      name: string;
      state: string | null;
      via: Map<string, { funderName: string; peers: Map<string, string> }>;
    }
  >();

  for (const row of rows) {
    const grantee = byGrantee.get(row.granteeEin) ?? {
      name: row.granteeName,
      state: row.granteeState,
      via: new Map<string, { funderName: string; peers: Map<string, string> }>(),
    };
    const via = grantee.via.get(row.viaFunderEin) ?? {
      funderName: row.viaFunderName,
      peers: new Map<string, string>(),
    };
    via.peers.set(row.peerEin, row.peerName);
    grantee.via.set(row.viaFunderEin, via);
    byGrantee.set(row.granteeEin, grantee);
  }

  const paths = [...byGrantee.entries()]
    .map(([granteeEin, grantee]): AffinityPath => {
      const via = [...grantee.via.entries()]
        .map(([funderEin, intermediary]) => ({
          funderEin,
          funderName: intermediary.funderName,
          peers: [...intermediary.peers.entries()]
            .map(([ein, name]) => ({ ein, name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => b.peers.length - a.peers.length || a.funderName.localeCompare(b.funderName));

      return {
        granteeEin,
        granteeName: grantee.name,
        granteeState: grantee.state,
        via,
        strength: Math.min(1, via.length / INTERMEDIARY_SATURATION),
      };
    })
    .sort((a, b) => b.strength - a.strength || a.granteeName.localeCompare(b.granteeName));

  return {
    paths,
    distinctIntermediaryFunders: new Set(rows.map((row) => row.viaFunderEin)).size,
    label: AFFINITY_PATH_LABEL,
    disclaimer: AFFINITY_PATH_DISCLAIMER,
  };
};
