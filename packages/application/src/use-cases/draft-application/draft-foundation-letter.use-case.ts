import { NotFoundError, ok, type Result } from '@merit/shared';
import {
  DraftSection as DraftSectionParser,
  observedPurposeLanguage,
  type DraftConditioning,
  type Organization,
} from '@merit/domain';
import type { Clock } from '../../ports/clock.port.js';
import type { DraftRepository, StoredDraft } from '../../ports/draft-repository.port.js';
import type { FunderRepository } from '../../ports/funder-repository.port.js';
import type { ModelGateway } from '../../ports/model.port.js';
import type { RepositoryUnavailable } from '../../errors.js';
import { foundationSectionPrompt } from './draft.prompts.js';

export interface DraftFoundationLetterInput {
  readonly organization: Organization;
  readonly funderEin: string;
}

export interface DraftFoundationLetterOutput {
  readonly funderName: string;
  readonly draft: StoredDraft;
}

/** How many observed purposes reach the prompt. Enough to establish a vocabulary, few enough
 *  that the model is reading a foundation's language rather than skimming a database dump. */
const PURPOSE_SAMPLE = 12;

const LETTER_HEADING = 'Letter of inquiry';

/**
 * S4, the foundation half: a letter of inquiry conditioned on what the funder has actually
 * funded, in the funder's own words.
 *
 * A private foundation publishes no rubric, so there is no criterion to draft against and
 * nothing to critique with. What it does publish, several hundred times, is the purpose line of
 * every grant it has made — and that is real evidence, because each line describes a grant it
 * really made rather than a priority it says it has.
 *
 * The conditioning is stated on the page for the same reason the federal path states it: a
 * letter written against a funder's observed language and a letter written against nothing read
 * identically, and only one of them is worth sending. A foundation with no purpose text on file
 * gets the honest version — a plain case for support, and a note saying there was nothing to
 * condition on.
 */
export class DraftFoundationLetter {
  constructor(
    private readonly funders: FunderRepository,
    private readonly drafts: DraftRepository,
    private readonly model: ModelGateway,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: DraftFoundationLetterInput,
  ): Promise<Result<DraftFoundationLetterOutput, RepositoryUnavailable | NotFoundError>> {
    const funder = await this.funders.findFunder(input.funderEin);
    if (!funder.ok) return funder;
    if (funder.value === null) {
      return {
        ok: false,
        error: new NotFoundError('no funder with this EIN is in the giving graph', {
          ein: input.funderEin,
        }),
      };
    }

    const organizationId = input.organization.id as string;

    // Same rule as the federal path: a complete draft is served, a partial one is retried.
    const existing = await this.drafts.findDraft(organizationId, input.funderEin);
    if (!existing.ok) return existing;
    if (existing.value !== null && existing.value.note === null) {
      return ok({ funderName: funder.value.name, draft: existing.value });
    }

    const history = await this.funders.loadGranteeHistory(input.funderEin);
    if (!history.ok) return history;

    const purposes = observedPurposeLanguage(history.value, PURPOSE_SAMPLE);
    const contract = DraftSectionParser.responseContract();

    const drafted = await this.model.complete({
      purpose: 'draft_foundation_letter',
      priority: 'interactive',
      prompt: foundationSectionPrompt(input.organization, funder.value.name, purposes, contract),
      responseContract: contract,
      parse: (raw) => DraftSectionParser.parse(raw),
    });

    const draft: StoredDraft = {
      organizationId,
      targetId: input.funderEin,
      targetKind: 'foundation',
      // No rubric exists for a foundation, and none is invented to fill the shape.
      rubric: null,
      conditioning: conditioningOf(funder.value.name, purposes, history.value.length),
      sections: drafted.ok
        ? [
            {
              criterionId: null,
              heading: LETTER_HEADING,
              text: drafted.value.value,
              subCriteria: purposes,
            },
          ]
        : [],
      // A foundation letter is never critiqued: there are no criteria to score it against, and
      // a score invented from nothing would be the worst number on the screen.
      critiqueBefore: null,
      critiqueAfter: null,
      revisedCriterionIds: [],
      note: drafted.ok ? null : `No letter could be drafted: ${drafted.error.message}.`,
      draftedAt: this.clock.now().toISOString(),
    };

    const saved = await this.drafts.saveDraft(draft);
    if (!saved.ok) return saved;

    return ok({ funderName: funder.value.name, draft });
  }
}

/**
 * What the letter was conditioned on, in the words the user reads.
 *
 * `confidence` is the share of this funder's grants that state a purpose at all — a real
 * coverage figure, not a model's opinion. A foundation with purpose text on three grants out of
 * two hundred has told us very little, and the note says the number rather than implying the
 * language is representative.
 */
const conditioningOf = (
  funderName: string,
  purposes: readonly string[],
  grantCount: number,
): DraftConditioning => {
  if (purposes.length === 0) {
    return {
      kind: 'summary',
      confidence: 0,
      note:
        `${funderName}'s filings state no purpose text for the ${grantCount} grants on file, so ` +
        'there was nothing to condition this letter on. It is a plain case for support, and it ' +
        'does not reflect anything about what this foundation prefers to fund.',
    };
  }

  return {
    kind: 'rubric',
    confidence: 1,
    note:
      `Written in ${funderName}'s own language: the ${purposes.length} purposes below are the ` +
      `most frequent stated purposes across the ${grantCount} grants it has on file. These ` +
      'describe grants it actually made, not priorities it announced. Foundations publish no ' +
      'scoring criteria, so this letter is not scored — check it against the funder’s own ' +
      'guidance before sending.',
  };
};
