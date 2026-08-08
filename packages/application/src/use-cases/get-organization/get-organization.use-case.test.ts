import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { Organization } from '@merit/domain';
import { unwrapOrThrow } from '@merit/shared';
import { InMemoryOrganizationRepository } from '../../testing/in-memory-organization.repository.js';
import { GetOrganization } from './get-organization.use-case.js';

const capeFear = unwrapOrThrow(
  Organization.parse({
    id: 'org_001',
    name: 'Cape Fear Literacy Council',
    ein: '58-1613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 655_738,
  }),
);

describe('GetOrganization', () => {
  it('returns the organisation stored under that id', async () => {
    const useCase = new GetOrganization(new InMemoryOrganizationRepository([capeFear]));
    const result = await useCase.execute({ organizationId: 'org_001' });
    expect(isOk(result) && result.value.name).toBe('Cape Fear Literacy Council');
  });

  it('reports a missing organisation as a not-found value, not an exception', async () => {
    const useCase = new GetOrganization(new InMemoryOrganizationRepository([capeFear]));
    const result = await useCase.execute({ organizationId: 'org_absent' });
    expect(isErr(result) && result.error.code).toBe('not_found');
  });

  it('names the id it could not find, so the caller can log something useful', async () => {
    const useCase = new GetOrganization(new InMemoryOrganizationRepository());
    const result = await useCase.execute({ organizationId: 'org_absent' });
    expect(isErr(result) && result.error.context['organizationId']).toBe('org_absent');
  });

  it('reports a repository failure as a value rather than throwing', async () => {
    const repository = new InMemoryOrganizationRepository([capeFear]);
    repository.failNextRead();
    const result = await new GetOrganization(repository).execute({ organizationId: 'org_001' });
    expect(isErr(result) && result.error.code).toBe('repository_unavailable');
  });
});
