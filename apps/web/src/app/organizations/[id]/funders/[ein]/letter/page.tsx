import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  draftFoundationLetter,
  getFoundationOutreach,
  getOrganization,
} from '../../../../../../composition/container.js';
import { DraftSections } from '../../../../../../features/draft-studio/components/draft-sections.js';
import { OutreachCard } from '../../../../../../features/outreach-tracking/components/outreach-card.js';
import { buildFoundationOutreachView } from '../../../../../../features/outreach-tracking/view-model.js';

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
  const outreach = await getFoundationOutreach().execute({
    organizationId: params.id,
    targetId: params.ein,
  });
  if (!outreach.ok) {
    return <Unavailable />;
  }

  const outreachView = buildFoundationOutreachView({
    funderName,
    recipientEmail: null,
    body: [
      `Dear ${funderName},`,
      '',
      ...draft.sections.flatMap((section) => [section.heading, '', section.text, '']),
      draft.note === null ? null : `Note: ${draft.note}`,
      '',
      `Best,`,
      organization.value.name,
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
    existing: outreach.value,
  });
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
    <section className="grid gap-8">
      <div className="shell-card p-6 sm:p-8">
        <Link
          href={`/organizations/${params.id}/funders/${params.ein}`}
          className="text-sm font-medium text-accent"
        >
          ← Back to {funderName}
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="soft-label">Foundation letter</span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">Letter of inquiry</h1>
            <p className="mt-2 text-base text-muted">{funderName}</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-muted">What this page shows</p>
            <p className="mt-2 max-w-sm text-sm leading-7 text-muted">
              The letter is conditioned on the funder’s own observed purpose language. Because foundations do
              not publish a rubric, there is no per-criterion score here.
            </p>
          </div>
        </div>

        <p
          className={`mt-6 max-w-prose rounded-2xl border p-4 text-sm ${
            draft.conditioning.kind === 'rubric'
              ? 'border-line bg-white/90'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
          data-testid="conditioning-note"
        >
          {draft.conditioning.note}
        </p>

        {draft.note === null ? null : (
          <p
            className="mt-3 max-w-prose rounded-2xl border border-line bg-white/90 p-4 text-sm"
            data-testid="draft-note"
          >
            {draft.note}
          </p>
        )}

        <p className="mt-4 max-w-prose text-sm leading-7 text-muted">
          This is a first draft for a human to take over, not a submission. Merit never submits anything and
          never contacts a funder.
        </p>
      </div>

      {sections.length === 0 ? (
        <p className="panel p-5 text-sm leading-7" data-testid="empty-reason">
          No letter could be drafted. The reason is stated above.
        </p>
      ) : (
        <div className="grid gap-8">
          <section className="panel p-6">
            <DraftSections sections={sections} />
          </section>
          <OutreachCard
            organizationId={params.id}
            targetId={params.ein}
            targetName={funderName}
            initialView={outreachView}
          />
        </div>
      )}
    </section>
  );
}

const Unavailable = () => (
  <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
    The database is unavailable, so no letter could be drafted. Nothing was lost.
  </p>
);
