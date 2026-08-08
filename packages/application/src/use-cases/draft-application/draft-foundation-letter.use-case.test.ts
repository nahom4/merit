import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Organization, type ReachabilityGrant } from '@merit/domain';
import { DraftFoundationLetter } from './draft-foundation-letter.use-case.js';
import { InMemoryDraftRepository } from '../../testing/in-memory-draft.repository.js';
import { InMemoryFunderRepository } from '../../testing/in-memory-funder.repository.js';
import { StubModelGateway } from '../../testing/stub-model.gateway.js';

const ORGANIZATION = unwrapOrThrow(
  Organization.parse({
    id: 'org_1',
    name: 'Cape Fear Literacy Council',
    ein: '581613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 656_000,
  }),
);

const LETTER = 'Cape Fear Literacy Council teaches adults to read in Wilmington, North Carolina.';

const grant = (purpose: string | null, index: number): ReachabilityGrant =>
  ({
    granteeKey: `grantee_${index}`,
    granteeName: `Grantee ${index}`,
    granteeState: 'NC',
    granteeNteeMajorGroup: 'Education',
    granteeRevenueCents: 500_000_00,
    taxYear: 2024,
    amountCents: 25_000_00,
    irsObjectId: `object_${index}`,
    purpose,
  }) as ReachabilityGrant;

const build = (
  purposes: readonly (string | null)[],
  model = StubModelGateway.answering({ text: LETTER }),
) => {
  const funders = new InMemoryFunderRepository([
    {
      profile: {
        ein: '560529965',
        name: 'The Duke Endowment',
        state: 'NC',
        sourceForms: '990PF',
        firstTaxYear: 2023,
        lastTaxYear: 2024,
      },
      grants: purposes.map(grant),
      sharedFunderPaths: [],
    },
  ]);
  const drafts = new InMemoryDraftRepository();

  return {
    drafts,
    model,
    useCase: new DraftFoundationLetter(funders, drafts, model, {
      now: () => new Date('2026-08-08T10:00:00Z'),
    }),
  };
};

const run = (built: ReturnType<typeof build>) =>
  built.useCase.execute({ organization: ORGANIZATION, funderEin: '560529965' });

describe('DraftFoundationLetter', () => {
  it('conditions the letter on what the foundation has actually funded, in its own words', async () => {
    const built = build(['Adult literacy programming', 'Adult literacy programming', 'Rural health access']);

    const result = await run(built);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both purposes reach the prompt, most frequent first — this is the conditioning.
    const prompt = built.model.requests[0]?.prompt ?? '';
    expect(prompt).toContain('Adult literacy programming');
    expect(prompt).toContain('Rural health access');
    expect(prompt).toContain('in its own words');
  });

  it('tells the model to match vocabulary without claiming the organisation does that work', async () => {
    const built = build(['Adult literacy programming']);
    await run(built);

    expect(built.model.requests[0]?.prompt).toContain('Do not claim the');
    expect(built.model.requests[0]?.prompt).toContain('matching vocabulary is the point');
  });

  it('states the conditioning, with how many grants the language came from', async () => {
    const result = await run(build(['Adult literacy', 'Adult literacy', 'Rural health']));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.conditioning.note).toContain('The Duke Endowment');
    expect(result.value.draft.conditioning.note).toContain('3 grants');
    expect(result.value.draft.conditioning.note).toContain('actually made');
  });

  it('says there was nothing to condition on when no filing states a purpose', async () => {
    // The honest version. A letter written against nothing reads the same as one written
    // against a funder's language, and only one of them is worth sending.
    const result = await run(build([null, null, null]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.conditioning.kind).toBe('summary');
    expect(result.value.draft.conditioning.confidence).toBe(0);
    expect(result.value.draft.conditioning.note).toContain('nothing to condition this letter on');
  });

  it('never scores a foundation letter, because there are no criteria to score it against', async () => {
    const result = await run(build(['Adult literacy']));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.rubric).toBeNull();
    expect(result.value.draft.critiqueBefore).toBeNull();
    expect(result.value.draft.critiqueAfter).toBeNull();
    expect(result.value.draft.conditioning.note).toContain('not scored');
  });

  it('stores the letter against the funder, marked as a foundation draft', async () => {
    const built = build(['Adult literacy']);
    await run(built);

    const saved = await built.drafts.findDraft('org_1', '560529965');

    expect(saved.ok).toBe(true);
    if (!saved.ok || saved.value === null) return;
    expect(saved.value.targetKind).toBe('foundation');
    expect(saved.value.sections[0]?.text).toBe(LETTER);
  });

  it('keeps the quota’s failure as a note rather than losing the run', async () => {
    const result = await run(build(['Adult literacy'], StubModelGateway.outOfQuota()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.sections).toHaveLength(0);
    expect(result.value.draft.note).toContain('quota');
  });

  it('reports a funder that is not in the giving graph rather than drafting to nobody', async () => {
    const built = build(['Adult literacy']);

    const result = await built.useCase.execute({ organization: ORGANIZATION, funderEin: '999999999' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_found');
  });

  it('serves a stored letter rather than re-buying the call', async () => {
    const built = build(['Adult literacy']);
    await run(built);
    await run(built);

    expect(built.model.requests).toHaveLength(1);
  });
});
