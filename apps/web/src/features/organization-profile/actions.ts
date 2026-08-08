'use server';

import { redirect } from 'next/navigation';
import { createOrganization } from '../../composition/container.js';

export interface CreateOrganizationFormState {
  readonly error: string | null;
}

/**
 * Maps a form submission to the use case. No logic here beyond that mapping: the parse
 * lives in the domain, the duplicate check lives in the use case.
 */
export async function submitOrganizationProfile(
  _previous: CreateOrganizationFormState,
  formData: FormData,
): Promise<CreateOrganizationFormState> {
  const result = await createOrganization().execute({
    name: formData.get('name'),
    ein: formData.get('ein'),
    city: formData.get('city'),
    state: formData.get('state'),
    nteeCode: formData.get('nteeCode'),
    annualRevenueDollars: Number(formData.get('annualRevenueDollars')),
  });

  if (!result.ok) {
    return { error: messageFor(result.error.code, result.error.message) };
  }
  redirect(`/organizations/${result.value.id}`);
}

/** The user sees what to change, not an error code. */
const messageFor = (code: string, message: string): string => {
  if (code === 'duplicate_organization') return 'An organisation with this EIN is already on file.';
  if (code === 'repository_unavailable') return 'The database is unavailable. Nothing was saved.';
  return `That profile could not be saved: ${message}.`;
};
