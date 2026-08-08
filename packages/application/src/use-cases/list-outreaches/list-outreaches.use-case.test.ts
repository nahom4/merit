import { describe, expect, it } from 'vitest';
import { InMemoryOutreachRepository } from '../../testing/in-memory-outreach.repository.js';
import { ListOutreaches } from './list-outreaches.use-case.js';

describe('ListOutreaches', () => {
  it('returns only outreaches for the requested organisation', async () => {
    const outreaches = new InMemoryOutreachRepository();
    const useCase = new ListOutreaches(outreaches);

    await outreaches.upsertOutreach({
      organizationId: 'org_1',
      targetId: 'a',
      targetKind: 'foundation',
      targetName: 'Alpha',
      contactEmail: null,
      subject: 'Funding inquiry',
      body: 'Body',
      status: 'draft',
      gmailMessageId: null,
      gmailThreadId: null,
      lastSyncedAt: null,
      followUpsScheduledAt: null,
    });
    await outreaches.upsertOutreach({
      organizationId: 'org_2',
      targetId: 'b',
      targetKind: 'foundation',
      targetName: 'Beta',
      contactEmail: null,
      subject: 'Funding inquiry',
      body: 'Body',
      status: 'sent',
      gmailMessageId: null,
      gmailThreadId: null,
      lastSyncedAt: null,
      followUpsScheduledAt: null,
    });

    const result = await useCase.execute({ organizationId: 'org_1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.targetName).toBe('Alpha');
  });
});
