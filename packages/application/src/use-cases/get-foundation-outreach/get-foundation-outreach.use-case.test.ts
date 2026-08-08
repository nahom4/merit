import { describe, expect, it } from 'vitest';
import { InMemoryOutreachRepository } from '../../testing/in-memory-outreach.repository.js';
import { GetFoundationOutreach } from './get-foundation-outreach.use-case.js';

describe('GetFoundationOutreach', () => {
  it('reports a missing outreach as null', async () => {
    const outreaches = new InMemoryOutreachRepository();
    const useCase = new GetFoundationOutreach(outreaches);

    const result = await useCase.execute({ organizationId: 'org_1', targetId: '561234567' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });
});
