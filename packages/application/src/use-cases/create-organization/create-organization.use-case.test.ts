import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { InMemoryOrganizationRepository } from '../../testing/in-memory-organization.repository.js';
import { fixedIdGenerator } from '../../testing/fixed-id-generator.js';
import { CreateOrganization } from './create-organization.use-case.js';

const profile = {
  name: 'Cape Fear Literacy Council',
  ein: '58-1613254',
  city: 'Wilmington',
  state: 'NC',
  nteeCode: 'B60',
  annualRevenueDollars: 655_738,
};

const useCase = (repository: InMemoryOrganizationRepository) =>
  new CreateOrganization(repository, fixedIdGenerator('org_001'));

describe('CreateOrganization', () => {
  it('returns the organisation it created, with the generated id', async () => {
    const result = await useCase(new InMemoryOrganizationRepository()).execute(profile);
    expect(isOk(result) && result.value.id).toBe('org_001');
  });

  it('persists the organisation so it can be read back', async () => {
    const repository = new InMemoryOrganizationRepository();
    await useCase(repository).execute(profile);
    expect(await repository.count()).toBe(1);
  });

  it('rejects an invalid profile without touching the repository', async () => {
    const repository = new InMemoryOrganizationRepository();
    const result = await useCase(repository).execute({ ...profile, state: 'ZZ' });
    expect(isErr(result) && result.error.code).toBe('parse_error');
    expect(await repository.count()).toBe(0);
  });

  it('refuses a second organisation with the same EIN rather than creating a duplicate', async () => {
    const repository = new InMemoryOrganizationRepository();
    await useCase(repository).execute(profile);
    const result = await new CreateOrganization(repository, fixedIdGenerator('org_002')).execute(profile);
    expect(isErr(result) && result.error.code).toBe('duplicate_organization');
    expect(await repository.count()).toBe(1);
  });

  it('reports a repository failure as a value rather than throwing', async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.failNextSave();
    const result = await useCase(repository).execute(profile);
    expect(isErr(result) && result.error.code).toBe('repository_unavailable');
  });
});
