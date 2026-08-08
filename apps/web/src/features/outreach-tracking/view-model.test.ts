import { describe, expect, it } from 'vitest';
import { buildFoundationOutreachView } from './view-model.js';

describe('buildFoundationOutreachView', () => {
  it('fills Gmail compose with the subject and body while allowing an empty recipient', () => {
    const view = buildFoundationOutreachView({
      funderName: 'Smith Foundation',
      recipientEmail: null,
      body: 'Dear Smith Foundation,\n\nWe would like to connect.',
      existing: null,
    });

    expect(view.subject).toBe('Funding inquiry: Smith Foundation');
    expect(view.composeHref).toContain('mail.google.com/mail/');
    expect(view.composeHref).not.toContain('to=');
    expect(view.statusLabel).toBe('Draft saved locally');
  });
});
