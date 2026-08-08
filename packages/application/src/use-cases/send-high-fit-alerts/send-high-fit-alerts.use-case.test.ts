import { describe, expect, it } from 'vitest';
import { Organization, type FederalOpportunity } from '@merit/domain';
import { unwrapOrThrow } from '@merit/shared';
import { SendHighFitAlerts } from './send-high-fit-alerts.use-case.js';
import { InMemoryNotificationRepository } from '../../testing/in-memory-notification.repository.js';
import { InMemoryOpportunityRepository } from '../../testing/in-memory-opportunity.repository.js';
import { StubGmailGateway } from '../../testing/stub-gmail.gateway.js';

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

const opportunity = (id: string, number: string): FederalOpportunity => ({
  id,
  number,
  title: `Announcement ${number}`,
  agency: 'Department of Education',
  status: 'posted',
  openDate: '2026-08-08',
  closeDate: '2026-08-24',
  programNumbers: ['84.002'],
  programTitles: ['Adult Education'],
  applicantTypeCodes: ['12'],
  eligibilityText: 'Nonprofits may apply.',
  summary: 'A summary.',
  fundingCategories: ['Education'],
  awardCeilingCents: 300_000_00,
  awardFloorCents: 150_000_00,
  estimatedFundingCents: 2_100_000_00,
  expectedAwardCount: 7,
  attachments: [],
});

const assessment = (opportunityId: string, fitScore: number) => ({
  organizationId: 'org_1',
  opportunityId,
  screening: { outcome: 'eligible' as const, checks: [], rejections: [], unresolved: [] },
  fit:
    fitScore >= 0
      ? {
          fitScore,
          rationale: 'The announcement matches the organisation.',
          matchedProgramAreas: ['Education'],
          gaps: ['No evaluation partner named.'],
        }
      : null,
  fitState: 'scored' as const,
  fitStateReason: null,
  assessedAt: '2026-08-08T06:00:00.000Z',
});

describe('SendHighFitAlerts', () => {
  it('alerts only above threshold and stays quiet on duplicate deliveries', async () => {
    const repository = new InMemoryOpportunityRepository([
      opportunity('opp_1', 'A-1'),
      opportunity('opp_2', 'A-2'),
    ]);
    await repository.saveAssessments([assessment('opp_1', 78), assessment('opp_2', 42)]);
    const notifications = new InMemoryNotificationRepository();
    const gmail = new StubGmailGateway();

    const useCase = new SendHighFitAlerts(repository, notifications, gmail);
    const first = await useCase.execute({
      organization,
      recipients: ['director@example.org'],
      threshold: 70,
      boardLimit: 10,
    });
    const second = await useCase.execute({
      organization,
      recipients: ['director@example.org'],
      threshold: 70,
      boardLimit: 10,
    });

    expect(first.ok ? first.value.alertsSent : 0).toBe(1);
    expect(first.ok ? first.value.alertsSuppressed : 0).toBe(0);
    expect(second.ok ? second.value.alertsSent : 0).toBe(0);
    expect(gmail.sent).toHaveLength(1);
    expect((await notifications.listNotifications('org_1', 'high_fit_alert')).ok).toBe(true);
  });

  it('remains silent below the threshold', async () => {
    const repository = new InMemoryOpportunityRepository([opportunity('opp_1', 'A-1')]);
    await repository.saveAssessments([assessment('opp_1', 55)]);
    const useCase = new SendHighFitAlerts(
      repository,
      new InMemoryNotificationRepository(),
      new StubGmailGateway(),
    );

    const result = await useCase.execute({
      organization,
      recipients: ['director@example.org'],
      threshold: 70,
      boardLimit: 10,
    });

    expect(result.ok ? result.value.alertsSent : -1).toBe(0);
  });
});
