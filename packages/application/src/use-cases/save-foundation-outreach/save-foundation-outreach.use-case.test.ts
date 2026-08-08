import { describe, expect, it } from 'vitest';
import { InMemoryOutreachRepository } from '../../testing/in-memory-outreach.repository.js';
import { SaveFoundationOutreach, gmailComposeHref } from './save-foundation-outreach.use-case.js';

describe('SaveFoundationOutreach', () => {
  it('stores the outreach draft and builds a Gmail compose link', async () => {
    const outreaches = new InMemoryOutreachRepository();
    const useCase = new SaveFoundationOutreach(outreaches);

    const result = await useCase.execute({
      organizationId: 'org_1',
      targetId: '561234567',
      targetName: 'Smith Foundation',
      contactEmail: 'jane@smithfoundation.org',
      subject: 'Funding inquiry: adult literacy',
      body: 'Dear Smith Foundation,\n\nWe would like to connect.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outreach.status).toBe('draft');
    expect(result.value.outreach.contactEmail).toBe('jane@smithfoundation.org');
    expect(result.value.composeHref).toContain('mail.google.com/mail/');
    expect(result.value.composeHref).toContain('to=jane%40smithfoundation.org');
    expect(result.value.composeHref).toContain('su=Funding+inquiry%3A+adult+literacy');

    const loaded = await outreaches.findOutreach('org_1', '561234567', 'foundation');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.value === null) return;
    expect(loaded.value.targetName).toBe('Smith Foundation');
    expect(loaded.value.subject).toBe('Funding inquiry: adult literacy');
  });

  it('allows an empty recipient so the user can fill To in Gmail', () => {
    const href = gmailComposeHref({
      contactEmail: null,
      subject: 'Funding inquiry',
      body: 'Hello there',
    });

    expect(href).toContain('su=Funding+inquiry');
    expect(href).not.toContain('to=');
  });
});
