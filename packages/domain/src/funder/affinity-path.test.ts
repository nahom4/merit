import { describe, expect, it } from 'vitest';
import {
  AFFINITY_PATH_DISCLAIMER,
  AFFINITY_PATH_LABEL,
  buildAffinityPaths,
  type SharedFunderRow,
} from './affinity-path.js';

const row = (overrides: Partial<SharedFunderRow> = {}): SharedFunderRow => ({
  granteeEin: '111111111',
  granteeName: 'Wilmington Reads',
  granteeState: 'NC',
  viaFunderEin: '999999999',
  viaFunderName: 'Coastal Community Foundation',
  peerEin: '222222222',
  peerName: 'Cape Fear Literacy Council',
  ...overrides,
});

describe('what the paths are', () => {
  it('groups the funder’s grantees that share a funder with one of our peers', () => {
    const result = buildAffinityPaths([row()]);

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.granteeName).toBe('Wilmington Reads');
    expect(result.paths[0]?.via[0]?.funderName).toBe('Coastal Community Foundation');
    expect(result.paths[0]?.via[0]?.peers[0]?.name).toBe('Cape Fear Literacy Council');
  });

  it('collapses repeated rows for one grantee into a single path', () => {
    const result = buildAffinityPaths([
      row({ viaFunderEin: '999999999', peerEin: '222222222' }),
      row({ viaFunderEin: '999999999', peerEin: '333333333', peerName: 'Second Peer' }),
      row({ viaFunderEin: '888888888', viaFunderName: 'Other Trust', peerEin: '222222222' }),
    ]);

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.via).toHaveLength(2);
    expect(result.paths[0]?.via.find((via) => via.funderEin === '999999999')?.peers).toHaveLength(2);
  });

  it('counts the distinct intermediary funders across every path', () => {
    const result = buildAffinityPaths([
      row({ granteeEin: '111111111', viaFunderEin: '999999999' }),
      row({ granteeEin: '444444444', granteeName: 'Second Grantee', viaFunderEin: '888888888' }),
    ]);

    expect(result.distinctIntermediaryFunders).toBe(2);
    expect(result.paths).toHaveLength(2);
  });

  it('has no paths when nothing connects, and says so rather than returning a bare empty list', () => {
    const result = buildAffinityPaths([]);

    expect(result.paths).toEqual([]);
    expect(result.distinctIntermediaryFunders).toBe(0);
  });
});

describe('strength', () => {
  it('rates a grantee reached through several shared funders above one reached through a single funder', () => {
    const result = buildAffinityPaths([
      row({ granteeEin: '111111111', viaFunderEin: '999999999' }),
      row({ granteeEin: '111111111', viaFunderEin: '888888888', viaFunderName: 'Other Trust' }),
      row({ granteeEin: '111111111', viaFunderEin: '777777777', viaFunderName: 'Third Trust' }),
      row({ granteeEin: '444444444', granteeName: 'Weakly Connected', viaFunderEin: '999999999' }),
    ]);

    const strong = result.paths.find((path) => path.granteeEin === '111111111')!;
    const weak = result.paths.find((path) => path.granteeEin === '444444444')!;
    expect(strong.strength).toBeGreaterThan(weak.strength);
  });

  it('never exceeds one however many funders are shared', () => {
    const result = buildAffinityPaths(
      Array.from({ length: 20 }, (_, index) => row({ viaFunderEin: `via-${index}` })),
    );

    expect(result.paths[0]?.strength).toBe(1);
  });

  it('orders the strongest path first', () => {
    const result = buildAffinityPaths([
      row({ granteeEin: '444444444', granteeName: 'Weak', viaFunderEin: '999999999' }),
      row({ granteeEin: '111111111', granteeName: 'Strong', viaFunderEin: '999999999' }),
      row({ granteeEin: '111111111', granteeName: 'Strong', viaFunderEin: '888888888' }),
    ]);

    expect(result.paths.map((path) => path.granteeName)).toEqual(['Strong', 'Weak']);
  });
});

describe('what a path is allowed to claim', () => {
  it('is labelled shared-funder proximity, which is exactly what it is', () => {
    expect(buildAffinityPaths([row()]).label).toBe(AFFINITY_PATH_LABEL);
    expect(AFFINITY_PATH_LABEL).toBe('shared-funder proximity');
  });

  it('denies being a personal connection in the words shown to the user', () => {
    // A development director must not read this as "you know someone here". The design
    // says label it as exactly what it is, so the denial travels with the data.
    expect(buildAffinityPaths([row()]).disclaimer).toBe(AFFINITY_PATH_DISCLAIMER);
    expect(AFFINITY_PATH_DISCLAIMER).toContain('not a personal connection');
  });

  it('never suggests an introduction or a relationship between people', () => {
    const text = `${AFFINITY_PATH_LABEL} ${AFFINITY_PATH_DISCLAIMER}`.toLowerCase();

    for (const forbidden of ['introduction', 'warm intro', 'knows', 'relationship with']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
