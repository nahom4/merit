import { describe, expect, it } from 'vitest';
import { Organization, type FederalOpportunity } from '@merit/domain';
import { unwrapOrThrow } from '@merit/shared';
import { PublishMilestones } from './publish-milestones.use-case.js';
import { InMemoryMilestoneRepository } from '../../testing/in-memory-milestone.repository.js';
import { StubCalendarGateway } from '../../testing/stub-calendar.gateway.js';
import { fixedClock } from '../../testing/fixed-id-generator.js';

const opportunity: FederalOpportunity = {
  id: 'opp_1',
  number: 'HHS-26-001',
  title: 'Community Health Grant',
  agency: 'HHS',
  status: 'posted',
  openDate: '2026-08-08',
  closeDate: '2026-08-24',
  programNumbers: ['93.800'],
  programTitles: ['Community Health'],
  applicantTypeCodes: ['12'],
  eligibilityText: 'Nonprofits may apply.',
  summary: 'A summary.',
  fundingCategories: ['Health'],
  awardCeilingCents: 300_000_00,
  awardFloorCents: 150_000_00,
  estimatedFundingCents: 2_100_000_00,
  expectedAwardCount: 7,
  attachments: [],
};

const organization = unwrapOrThrow(
  Organization.parse({
    id: 'org_1',
    name: 'Cape Fear Literacy Council',
    ein: '58-1613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 656_000,
  }),
);

describe('PublishMilestones', () => {
  it('proposes milestones without committing them when not approved', async () => {
    const result = await new PublishMilestones(
      new InMemoryMilestoneRepository(),
      new StubCalendarGateway(),
      fixedClock('2026-08-08T12:00:00.000Z'),
    ).execute({
      organizationId: organization.id as string,
      opportunity,
      approved: false,
      calendarId: 'primary',
      timeZone: 'America/New_York',
    });

    expect(result.ok ? result.value.committed : -1).toBe(0);
    expect(result.ok ? result.value.planned.map((milestone) => milestone.dueDate)[0] : null).toBe('2026-08-08');
  });

  it('writes approved milestones to Calendar and stores them once', async () => {
    const repository = new InMemoryMilestoneRepository();
    const calendar = new StubCalendarGateway();
    const result = await new PublishMilestones(
      repository,
      calendar,
      fixedClock('2026-08-08T12:00:00.000Z'),
    ).execute({
      organizationId: organization.id as string,
      opportunity,
      approved: true,
      calendarId: 'primary',
      timeZone: 'America/New_York',
    });

    expect(result.ok ? result.value.committed : -1).toBe(4);
    expect(calendar.events).toHaveLength(4);
    const stored = await repository.listDueMilestones('org_1', '2026-08-31');
    expect(stored.ok ? stored.value.length : 0).toBe(4);
  });
});
