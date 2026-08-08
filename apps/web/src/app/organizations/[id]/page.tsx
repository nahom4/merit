import { notFound } from 'next/navigation';
import { getOrganization } from '../../../composition/container.js';
import { toOrganizationProfileView } from '../../../features/organization-profile/view-model.js';
import { OrganizationProfileCard } from '../../../features/organization-profile/components/organization-profile-card.js';

export const dynamic = 'force-dynamic';

export default async function OrganizationPage({ params }: { params: { id: string } }) {
  const result = await getOrganization().execute({ organizationId: params.id });

  if (!result.ok) {
    if (result.error.code === 'not_found') notFound();
    // A repository failure is not a 404. Say what happened rather than implying the
    // organisation does not exist.
    return (
      <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
        The database is unavailable, so this profile could not be loaded. Nothing was lost.
      </p>
    );
  }

  return (
    <>
      <OrganizationProfileCard profile={toOrganizationProfileView(result.value)} />
      <a
        href={`/organizations/${params.id}/prospects`}
        className="mt-6 inline-block rounded bg-accent px-4 py-2 font-medium text-white"
      >
        See funder prospects
      </a>
    </>
  );
}
