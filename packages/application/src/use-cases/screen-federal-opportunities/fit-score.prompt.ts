import { NteeCode, UsState, type FederalOpportunity, type Organization } from '@merit/domain';

/**
 * The fit-score prompt.
 *
 * A prompt encodes product judgement -- what counts as fit, what the model may and may not
 * claim -- so it lives where it can be read, reviewed, and versioned rather than being buried
 * in the adapter that sends it. A change here is a logic change: it needs a test, and if it
 * moves the fit-score eval it needs an ADR.
 *
 * Two rules are stated to the model and enforced again at the parse boundary, because a rule
 * only stated in a prompt is a request: matched program areas come from a fixed menu, and no
 * probability of winning may be claimed (public award data has no denominator).
 */

const money = (cents: number | null): string =>
  cents === null ? 'not stated' : `$${Math.round(cents / 100).toLocaleString('en-US')}`;

/**
 * The menu of program areas a fit score may claim a match on: this organisation's own program
 * area, and the announcement's own funding categories. A model that answers outside this list
 * has invented a match, and the parse rejects it.
 */
export const programAreaMenu = (
  organization: Organization,
  opportunity: FederalOpportunity,
): readonly string[] => {
  const menu = [NteeCode.majorGroupLabel(organization.nteeCode), ...opportunity.fundingCategories];
  return [...new Set(menu.filter((area) => area.trim().length > 0))];
};

export const fitScorePrompt = (
  organization: Organization,
  opportunity: FederalOpportunity,
  responseContract: string,
): string =>
  [
    'You are assessing whether a small US nonprofit should spend its limited staff time applying',
    'to a federal funding announcement. Judge only the fit between what the announcement funds',
    'and what this organisation does. Eligibility has already been decided by rule; do not',
    'revisit it, and do not estimate any chance of winning.',
    '',
    'ORGANISATION',
    `Name: ${organization.name}`,
    `Location: ${organization.city}, ${UsState.label(UsState.toString(organization.state))}`,
    `Program area: ${NteeCode.majorGroupLabel(organization.nteeCode)} (NTEE ${NteeCode.toString(organization.nteeCode)})`,
    `Annual revenue: ${money(organization.annualRevenue as number)}`,
    '',
    'ANNOUNCEMENT',
    `Number: ${opportunity.number}`,
    `Title: ${opportunity.title}`,
    `Agency: ${opportunity.agency}`,
    `Federal program number: ${opportunity.programNumbers.join(', ') || 'not stated'}`,
    `Funding categories: ${opportunity.fundingCategories.join(', ') || 'not stated'}`,
    `Award range: ${money(opportunity.awardFloorCents)} to ${money(opportunity.awardCeilingCents)}`,
    `Expected awards: ${opportunity.expectedAwardCount ?? 'not stated'}`,
    `Closes: ${opportunity.closeDate ?? 'not stated'}`,
    '',
    'Purpose, in the announcement’s own words:',
    opportunity.summary ?? 'The announcement states no summary.',
    '',
    'A high score means this organisation’s existing programs are what the announcement asks to',
    'fund, at a scale it could deliver. A low score means the money is for work it does not do,',
    'or at a scale it could not absorb. Say what it cannot currently show in "gaps" — an',
    'unmeasured outcome, a missing partner, a capacity the profile does not evidence.',
    '',
    responseContract,
  ].join('\n');
