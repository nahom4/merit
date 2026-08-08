import { NotFoundError, ok, type Result } from '@merit/shared';
import {
  conditioningFor,
  Critique,
  DraftSection as DraftSectionParser,
  isTrustworthy,
  reviewSectionOf,
  revisionOrder,
  Rubric,
  selectRubricSource,
  SUMMARY_SECTION_HEADING,
  type Critique as CritiqueValue,
  type DraftSection,
  type FederalOpportunity,
  type Organization,
  type Rubric as RubricValue,
} from '@merit/domain';
import type { AnnouncementDocumentGateway } from '../../ports/announcement-document.port.js';
import type { Clock } from '../../ports/clock.port.js';
import type { DraftRepository, StoredDraft } from '../../ports/draft-repository.port.js';
import type { ModelGateway } from '../../ports/model.port.js';
import type { OpportunityRepository } from '../../ports/opportunity-repository.port.js';
import type { RepositoryUnavailable } from '../../errors.js';
import {
  critiquePrompt,
  revisionPrompt,
  rubricPrompt,
  sectionPrompt,
  summarySectionPrompt,
} from './draft.prompts.js';

export interface DraftApplicationInput {
  readonly organization: Organization;
  readonly opportunityId: string;
}

export interface DraftApplicationOutput {
  readonly opportunity: FederalOpportunity;
  readonly draft: StoredDraft;
}

/**
 * How much of the announcement's text is sent to the rubric extractor. Roughly 1,000 tokens of
 * a 60-page document — generous enough to hold a review section with its lead-in, small enough
 * that extraction stays affordable on a free tier.
 */
const RUBRIC_TEXT_BUDGET = 12_000;

/**
 * How many criteria get a revision call.
 *
 * Every criterion could be revised, and on a ten-criterion rubric that is ten more calls for a
 * diminishing return: the bottom of a points-ordered list is where a rewrite wins two points.
 * Three is where the curve flattens on the rubrics seen so far. It is a budget, not a finding.
 */
const REVISION_BUDGET = 3;

/**
 * S4: read the rubric, draft against it, score the draft, revise where it pays.
 *
 * The shape is the same cascade S3 established, for the same reason — model calls are the
 * scarce resource — but the failure handling is different in one important way. S3 could queue
 * an unscored opportunity and lose nothing. Here, a run that fails at step four has already
 * spent three calls, and throwing that away to return an error would be the expensive kind of
 * tidy. So every stage degrades into the draft rather than out of it: whatever was produced is
 * saved, with a note in plain words saying where it stopped and why.
 *
 * The one thing never degraded is honesty about conditioning. A draft written without a trusted
 * rubric says so on the screen, every time, because the two are indistinguishable by reading.
 */
export class DraftApplication {
  constructor(
    private readonly opportunities: OpportunityRepository,
    private readonly drafts: DraftRepository,
    private readonly documents: AnnouncementDocumentGateway,
    private readonly model: ModelGateway,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: DraftApplicationInput,
  ): Promise<Result<DraftApplicationOutput, RepositoryUnavailable | NotFoundError>> {
    const found = await this.opportunities.findOpportunity(input.opportunityId);
    if (!found.ok) return found;
    if (found.value === null) {
      return {
        ok: false,
        error: new NotFoundError('no federal opportunity with this id has been swept', {
          opportunityId: input.opportunityId,
        }),
      };
    }

    const opportunity = found.value;
    const notes: string[] = [];

    const rubric = await this.extractRubric(opportunity, notes);
    const trusted = rubric !== null && isTrustworthy(rubric);
    const conditioning = conditioningFor(rubric, trusted);

    const sections =
      trusted && rubric !== null
        ? await this.draftAgainstRubric(input.organization, opportunity, rubric, notes)
        : await this.draftFromSummary(input.organization, opportunity, notes);

    // Critique needs a rubric to score against and text to score. Without either there is
    // nothing to say, and inventing a scale to score against would be the worst kind of number.
    const scored =
      trusted && rubric !== null && sections.length === rubric.criteria.length
        ? await this.critiqueAndRevise(input.organization, rubric, sections, notes)
        : { sections, critiqueBefore: null, critiqueAfter: null, revisedCriterionIds: [] };

    const draft: StoredDraft = {
      organizationId: input.organization.id as string,
      targetId: opportunity.id,
      targetKind: 'federal',
      rubric,
      conditioning,
      sections: scored.sections,
      critiqueBefore: scored.critiqueBefore,
      critiqueAfter: scored.critiqueAfter,
      revisedCriterionIds: scored.revisedCriterionIds,
      note: notes.length > 0 ? notes.join(' ') : null,
      draftedAt: this.clock.now().toISOString(),
    };

    // Saved before returning, always. The calls are already paid for, and a reload that
    // re-buys them because the write came last is a bug that costs real quota.
    const saved = await this.drafts.saveDraft(draft);
    if (!saved.ok) return saved;

    return ok({ opportunity, draft });
  }

  /** Null whenever the rubric could not be read for any reason. The reason goes in `notes`. */
  private async extractRubric(opportunity: FederalOpportunity, notes: string[]): Promise<RubricValue | null> {
    const source = selectRubricSource(opportunity.attachments, opportunity.number);
    if (source === null) {
      // Not a failure worth a note of its own: `conditioningFor` already says there was no
      // rubric, and repeating it here would say the same thing twice on the screen.
      return null;
    }

    const document = await this.documents.fetchText(source.id);
    if (!document.ok) {
      notes.push(`The announcement’s document could not be read: ${document.error.message}.`);
      return null;
    }

    const window = reviewSectionOf(document.value, RUBRIC_TEXT_BUDGET);
    const contract = Rubric.responseContract();

    const extracted = await this.model.complete({
      purpose: 'rubric',
      priority: 'interactive',
      prompt: rubricPrompt(window.text, opportunity, window.headingFound, contract),
      responseContract: contract,
      parse: (raw) => Rubric.parse(raw),
    });

    if (!extracted.ok) {
      notes.push(`The review rubric could not be extracted: ${extracted.error.message}.`);
      return null;
    }
    if (window.windowed && !window.headingFound) {
      notes.push(
        'No review-criteria heading was found in the announcement, so the rubric was extracted ' +
          'from the start of the document.',
      );
    }
    return extracted.value.value;
  }

  /** One section per criterion, each conditioned on that criterion's sub-criteria. */
  private async draftAgainstRubric(
    organization: Organization,
    opportunity: FederalOpportunity,
    rubric: RubricValue,
    notes: string[],
  ): Promise<readonly DraftSection[]> {
    const contract = DraftSectionParser.responseContract();
    const sections: DraftSection[] = [];

    for (const criterion of rubric.criteria) {
      const drafted = await this.model.complete({
        purpose: 'draft_section',
        priority: 'interactive',
        prompt: sectionPrompt(organization, opportunity, criterion, rubric, contract),
        responseContract: contract,
        parse: (raw) => DraftSectionParser.parse(raw),
      });

      if (!drafted.ok) {
        // Stop, keep what exists, say where it stopped. Continuing would spend the remaining
        // quota on later sections while leaving a hole in the middle of the document.
        notes.push(
          `Drafting stopped after ${sections.length} of ${rubric.criteria.length} sections: ` +
            `${drafted.error.message}. Nothing already drafted was lost.`,
        );
        return sections;
      }

      sections.push({
        criterionId: criterion.id,
        heading: `${criterion.id}. ${criterion.name}`,
        text: drafted.value.value,
        subCriteria: criterion.subCriteria,
      });
    }

    return sections;
  }

  /** The fallback: one narrative section, written against the announcement's stated purpose. */
  private async draftFromSummary(
    organization: Organization,
    opportunity: FederalOpportunity,
    notes: string[],
  ): Promise<readonly DraftSection[]> {
    const contract = DraftSectionParser.responseContract();

    const drafted = await this.model.complete({
      purpose: 'draft_section',
      priority: 'interactive',
      prompt: summarySectionPrompt(organization, opportunity, contract),
      responseContract: contract,
      parse: (raw) => DraftSectionParser.parse(raw),
    });

    if (!drafted.ok) {
      notes.push(`No narrative could be drafted: ${drafted.error.message}.`);
      return [];
    }

    return [
      {
        criterionId: null,
        heading: SUMMARY_SECTION_HEADING,
        text: drafted.value.value,
        subCriteria: [],
      },
    ];
  }

  /**
   * Score, revise the criteria worth revising, score again.
   *
   * The second critique is not decoration. Revision is the one step here whose value is
   * genuinely uncertain — a model asked to improve its own text will always produce different
   * text and not always better text — and scoring both versions is what turns that from a claim
   * into something the screen can show a user and let them judge.
   */
  private async critiqueAndRevise(
    organization: Organization,
    rubric: RubricValue,
    sections: readonly DraftSection[],
    notes: string[],
  ): Promise<{
    readonly sections: readonly DraftSection[];
    readonly critiqueBefore: CritiqueValue | null;
    readonly critiqueAfter: CritiqueValue | null;
    readonly revisedCriterionIds: readonly string[];
  }> {
    const before = await this.critique(rubric, sections, notes);
    if (before === null) {
      return { sections, critiqueBefore: null, critiqueAfter: null, revisedCriterionIds: [] };
    }

    const revised = [...sections];
    const revisedCriterionIds: string[] = [];
    const contract = DraftSectionParser.responseContract();

    for (const target of revisionOrder(before).slice(0, REVISION_BUDGET)) {
      // A criterion at full marks has nothing to win back, and the calls are finite.
      if (target.pointsAtStake === 0) continue;

      const index = revised.findIndex((section) => section.criterionId === target.criterionId);
      const criterion = rubric.criteria.find((entry) => entry.id === target.criterionId);
      const section = revised[index];
      if (index === -1 || criterion === undefined || section === undefined) continue;

      const rewritten = await this.model.complete({
        purpose: 'revise_section',
        priority: 'interactive',
        prompt: revisionPrompt(organization, criterion, target, section.text, contract),
        responseContract: contract,
        parse: (raw) => DraftSectionParser.parse(raw),
      });

      if (!rewritten.ok) {
        notes.push(
          `Revision stopped after ${revisedCriterionIds.length} of ${REVISION_BUDGET} sections: ` +
            `${rewritten.error.message}.`,
        );
        break;
      }

      revised[index] = { ...section, text: rewritten.value.value };
      revisedCriterionIds.push(target.criterionId);
    }

    // Nothing was rewritten, so the first critique is still the current one. Scoring identical
    // text twice would be a call spent to learn what we already know.
    if (revisedCriterionIds.length === 0) {
      return { sections: revised, critiqueBefore: before, critiqueAfter: before, revisedCriterionIds };
    }

    const after = await this.critique(rubric, revised, notes);
    return { sections: revised, critiqueBefore: before, critiqueAfter: after, revisedCriterionIds };
  }

  /** Null on any failure, including a fabricated citation. A rejected critique is not stored. */
  private async critique(
    rubric: RubricValue,
    sections: readonly DraftSection[],
    notes: string[],
  ): Promise<CritiqueValue | null> {
    const draftText = sections.map((section) => `${section.heading}\n${section.text}`).join('\n\n');
    const contract = Critique.responseContract(rubric);

    const scored = await this.model.complete({
      purpose: 'critique',
      priority: 'interactive',
      prompt: critiquePrompt(rubric, draftText, contract),
      responseContract: contract,
      parse: (raw) => Critique.parse(raw, rubric, draftText),
    });

    if (!scored.ok) {
      notes.push(`The draft could not be scored: ${scored.error.message}.`);
      return null;
    }
    return scored.value.value;
  }
}
