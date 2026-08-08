import { notFound } from 'next/navigation';
import { draftFoundationLetter, getOrganization } from '../../../../../../composition/container.js';
import { DraftSections } from '../../../../../../features/draft-studio/components/draft-sections.js';

export const dynamic = 'force-dynamic';

/**
 * S4, the foundation half: a letter of inquiry conditioned on the funder's own observed purpose
 * language.
 *
 * Deliberately simpler than the federal studio, and the difference is honest rather than
 * unfinished. A foundation publishes no scoring criteria, so there is nothing to score the
 * letter against — and a per-criterion score invented from nothing would be the least defensible
 * number in the product. The page shows what the letter was written against and stops there.
 */
export default async function FoundationLetterPage({ params }: { params: { id: string; ein: string } }) {
  const organization = await getOrganization().execute({ organizationId: params.id });
  if (!organization.ok) {
    if (organization.error.code === 'not_found') notFound();
    return <Unavailable />;
  }

  const drafted = await draftFoundationLetter().execute({
    organization: organization.value,
    funderEin: params.ein,
  });
  if (!drafted.ok) {
    if (drafted.error.code === 'not_found') notFound();
    return <Unavailable />;
  }

  const { draft, funderName } = drafted.value;
  const sections = draft.sections.map((section) => ({
    heading: section.heading,
    text: section.text,
    subCriteria: section.subCriteria,
    subCriteriaNote:
      section.subCriteria.length > 0
        ? 'These are the purposes this foundation has actually funded, taken from its own filings.'
        : null,
    wasRevised: false,
    placeholders: [...new Set([...section.text.matchAll(/\[([^\]]{3,200})\]/gu)].map((m) => `[${m[1]}]`))],
  }));

  return (
    <section>
      <a href={`/organizations/${params.id}/funders/${params.ein}`} className="text-sm text-accent">
        ← Back to {funderName}
      </a>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Letter of inquiry</h1>
      <p className="mt-1 text-sm text-muted">{funderName}</p>

      {/* Stated in both branches, as everywhere in S4: a letter written against a funder's own
          language and one written against nothing read identically on the page. */}
      <p
        className={`mt-4 max-w-prose rounded border p-4 text-sm ${
          draft.conditioning.kind === 'rubric'
            ? 'border-line bg-gray-50'
            : 'border-amber-300 bg-amber-50 text-amber-900'
        }`}
        data-testid="conditioning-note"
      >
        {draft.conditioning.note}
      </p>

      {draft.note === null ? null : (
        <p
          className="mt-3 max-w-prose rounded border border-line bg-gray-50 p-4 text-sm"
          data-testid="draft-note"
        >
          {draft.note}
        </p>
      )}

      <p className="mt-4 max-w-prose text-sm text-muted">
        This is a first draft for a human to take over, not a submission. Merit never submits anything and
        never contacts a funder.
      </p>

      {sections.length === 0 ? (
        <p
          className="mt-8 max-w-prose rounded border border-line bg-gray-50 p-4 text-sm"
          data-testid="empty-reason"
        >
          No letter could be drafted. The reason is stated above.
        </p>
      ) : (
        <DraftSections sections={sections} />
      )}
    </section>
  );
}

const Unavailable = () => (
  <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
    The database is unavailable, so no letter could be drafted. Nothing was lost.
  </p>
);
