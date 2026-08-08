import {
  NteeCode,
  UsState,
  type FederalOpportunity,
  type Organization,
  type RevisionTarget,
  type Rubric,
  type RubricCriterion,
} from '@merit/domain';

/**
 * The drafting prompts.
 *
 * They live here, beside the use case, for the reason `fit-score.prompt.ts` gives: a prompt
 * encodes product judgement — what may be claimed, what must not be invented — so it belongs
 * where it can be read and reviewed, not buried in an adapter. A change here is a logic change.
 *
 * One rule runs through all of them and is enforced again at every parse boundary, because a
 * rule that only exists in a prompt is a request: **nothing may be invented about the
 * organisation**. A grant application that states an outcome the nonprofit never measured is not
 * a draft with an error in it. It is a false statement to a federal agency with the
 * organisation's name on it, and the human who signs it is the one who carries that.
 */

const money = (cents: number | null): string =>
  cents === null ? 'not stated' : `$${Math.round(cents / 100).toLocaleString('en-US')}`;

/** The organisation, in the only terms Merit actually holds. Deliberately short: every line
 *  here is a line the model may build a sentence on, and there are no others. */
const profileOf = (organization: Organization): readonly string[] => [
  'THE ORGANISATION APPLYING',
  `Name: ${organization.name}`,
  `Location: ${organization.city}, ${UsState.label(UsState.toString(organization.state))}`,
  `Program area: ${NteeCode.majorGroupLabel(organization.nteeCode)} (NTEE ${NteeCode.toString(organization.nteeCode)})`,
  `Annual revenue: ${money(organization.annualRevenue as number)}`,
  '',
  'That profile is everything Merit knows about this organisation. It is not much, and you must',
  'not fill the gaps. Any fact you need that is not stated above — a number served, a named',
  'partner, an outcome, a staff member, a year founded — goes in square brackets as an',
  'instruction to the human who will finish this draft.',
];

/**
 * Rubric extraction, run over the windowed announcement text.
 *
 * The instruction not to infer is repeated in the response contract, and the parse enforces
 * what it can. What it cannot enforce is whether a criterion is real — that is what the
 * arithmetic check on the point total is for.
 */
export const rubricPrompt = (
  documentText: string,
  opportunity: FederalOpportunity,
  headingFound: boolean,
  responseContract: string,
): string =>
  [
    'You are reading a US federal notice of funding opportunity, extracted from PDF. The layout',
    'is preserved, so tables appear as aligned columns. Find the section that tells reviewers how',
    'to score an application, and extract it exactly as written.',
    '',
    `Announcement: ${opportunity.number} — ${opportunity.title}`,
    `Agency: ${opportunity.agency}`,
    '',
    headingFound
      ? 'The extract below is the part of the document around its review-criteria heading.'
      : 'No review-criteria heading could be located, so the extract below is the start of the ' +
        'document. The criteria may not be in it at all. If they are not, say so with a ' +
        'confidence of 0 rather than reconstructing what they probably are.',
    '',
    '--- DOCUMENT EXTRACT ---',
    documentText,
    '--- END OF EXTRACT ---',
    '',
    responseContract,
  ].join('\n');

/** One section, conditioned on the sub-criteria that section is scored against. */
export const sectionPrompt = (
  organization: Organization,
  opportunity: FederalOpportunity,
  criterion: RubricCriterion,
  rubric: Rubric,
  responseContract: string,
): string =>
  [
    'You are drafting one section of a US federal grant application, for a small nonprofit with',
    'very little staff time. Write the section that this criterion is scored against, and nothing',
    'else — no heading, no preamble, no closing.',
    '',
    ...profileOf(organization),
    '',
    'THE ANNOUNCEMENT',
    `Number: ${opportunity.number} — ${opportunity.title}`,
    `Agency: ${opportunity.agency}`,
    `Purpose, in the announcement’s own words: ${opportunity.summary ?? 'not stated'}`,
    '',
    'THE CRITERION THIS SECTION IS SCORED AGAINST',
    `${criterion.id}. ${criterion.name} — worth ${criterion.points} of ${rubric.totalPoints} points.`,
    criterion.subCriteria.length > 0
      ? `A reviewer is told to look for:\n${criterion.subCriteria.map((sub) => `  - ${sub}`).join('\n')}`
      : 'The announcement states no sub-criteria for it beyond the heading above.',
    '',
    'Address every point a reviewer is told to look for, in the order they are listed. A reviewer',
    'scoring this section has the list in front of them, so a section that answers four of five',
    'loses the fifth outright.',
    '',
    responseContract,
  ].join('\n');

/**
 * The fallback: no trusted rubric, so the section is written against the announcement's summary.
 *
 * The prompt says the criteria are unknown rather than pretending otherwise, because a model
 * told to write "a strong application" invents a rubric to be strong against, and the result
 * reads exactly like a rubric-conditioned draft while being aimed at nothing.
 */
export const summarySectionPrompt = (
  organization: Organization,
  opportunity: FederalOpportunity,
  responseContract: string,
): string =>
  [
    'You are drafting the narrative of a US federal grant application for a small nonprofit.',
    '',
    'The announcement’s scoring criteria could not be read from its documents, so you are writing',
    'against its stated purpose instead. Do not guess what the criteria are and do not organise',
    'the narrative around invented headings. Write a general case for support: what the need is,',
    'what this organisation would do about it, and why it is the organisation to do it.',
    '',
    ...profileOf(organization),
    '',
    'THE ANNOUNCEMENT',
    `Number: ${opportunity.number} — ${opportunity.title}`,
    `Agency: ${opportunity.agency}`,
    `Award range: ${money(opportunity.awardFloorCents)} to ${money(opportunity.awardCeilingCents)}`,
    `Purpose, in the announcement’s own words: ${opportunity.summary ?? 'not stated'}`,
    '',
    responseContract,
  ].join('\n');

/**
 * Foundation drafting, conditioned on the funder's own observed purpose language.
 *
 * The conditioning is the point. A private foundation publishes no rubric, but it has told us
 * what it funds several hundred times already, in the purpose lines of its own 990 filings.
 * Those lines are evidence in a way a mission statement on a website is not: they describe
 * grants the foundation actually made. The prompt hands them over as observed language and says
 * exactly that, so the model matches the funder's vocabulary without being invited to claim the
 * organisation already does that work.
 */
export const foundationSectionPrompt = (
  organization: Organization,
  funderName: string,
  observedPurposes: readonly string[],
  responseContract: string,
): string =>
  [
    'You are drafting a letter of inquiry to a private foundation, for a small nonprofit.',
    '',
    ...profileOf(organization),
    '',
    `THE FOUNDATION: ${funderName}`,
    observedPurposes.length > 0
      ? [
          'These are the stated purposes of grants this foundation has actually made, taken from its',
          'own IRS filings. They are what it funds, in its own words:',
          ...observedPurposes.map((purpose) => `  - ${purpose}`),
          '',
          'Write in language this foundation would recognise as its own. Do not claim the',
          'organisation already does work it does not do — matching vocabulary is the point, not',
          'matching the programme.',
        ].join('\n')
      : 'Its filings state no purpose language for the grants it has made, so there is nothing to ' +
        'condition on. Write a plain case for support and do not speculate about its priorities.',
    '',
    responseContract,
  ].join('\n');

/** The critique. The draft is handed over whole so a citation may come from any section. */
export const critiquePrompt = (rubric: Rubric, draftText: string, responseContract: string): string =>
  [
    'You are a grant reviewer scoring a draft against the announcement’s own criteria. Score it as',
    'written, not as it could be. Be hard on it: a draft praised into a submission wastes weeks of',
    'a nonprofit’s time, and an honest low score is the useful answer.',
    '',
    'THE CRITERIA',
    ...rubric.criteria.map((criterion) =>
      [
        `${criterion.id}. ${criterion.name} — ${criterion.points} points`,
        ...criterion.subCriteria.map((sub) => `     - ${sub}`),
      ].join('\n'),
    ),
    `Total available: ${rubric.totalPoints} points.`,
    '',
    '--- THE DRAFT ---',
    draftText,
    '--- END OF DRAFT ---',
    '',
    'A bracketed placeholder such as "[the number of adults served last year]" is a gap the human',
    'has not filled yet. Score it as the missing fact it is, and say so in the comment.',
    '',
    responseContract,
  ].join('\n');

/** One revision pass over one section, told exactly what it lost points for. */
export const revisionPrompt = (
  organization: Organization,
  criterion: RubricCriterion,
  target: RevisionTarget,
  currentText: string,
  responseContract: string,
): string =>
  [
    'You are revising one section of a grant application that has just been scored by a reviewer.',
    '',
    ...profileOf(organization),
    '',
    'THE CRITERION',
    `${criterion.id}. ${criterion.name} — worth ${criterion.points} points.`,
    criterion.subCriteria.length > 0
      ? `A reviewer is told to look for:\n${criterion.subCriteria.map((sub) => `  - ${sub}`).join('\n')}`
      : 'The announcement states no sub-criteria for it.',
    '',
    'WHAT THE REVIEWER SAID',
    target.comment,
    `${target.pointsAtStake} of ${target.maxPoints} points were not awarded.`,
    '',
    '--- THE SECTION AS IT STANDS ---',
    currentText,
    '--- END OF SECTION ---',
    '',
    'Rewrite the section to answer the reviewer. Keep everything that already works. Do not',
    'resolve a criticism by inventing the missing fact — if the reviewer says a number is absent',
    'and the profile does not contain it, write the sentence around a bracketed placeholder so',
    'the human knows exactly what to supply.',
    '',
    responseContract,
  ].join('\n');
