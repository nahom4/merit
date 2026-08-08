import { notFound } from 'next/navigation';
import { draftApplication, getOrganization } from '../../../../../../composition/container.js';
import { toDraftStudioView } from '../../../../../../features/draft-studio/view-model.js';
import { CriterionScores } from '../../../../../../features/draft-studio/components/criterion-scores.js';
import { DraftSections } from '../../../../../../features/draft-studio/components/draft-sections.js';

export const dynamic = 'force-dynamic';

/**
 * S4: the draft studio — the draft beside the rubric it was written against, with the
 * per-criterion scores before and after revision and the weak criteria named.
 *
 * A server component that calls one use case and renders what it returns. Unlike the board,
 * which screens on every load because screening is free, this page costs real model calls, so
 * the use case persists what it produces and serves the stored draft on a reload.
 */
export default async function DraftStudioPage({ params }: { params: { id: string; opportunityId: string } }) {
  const organization = await getOrganization().execute({ organizationId: params.id });
  if (!organization.ok) {
    if (organization.error.code === 'not_found') notFound();
    return <Unavailable />;
  }

  const drafted = await draftApplication().execute({
    organization: organization.value,
    opportunityId: params.opportunityId,
  });
  if (!drafted.ok) {
    if (drafted.error.code === 'not_found') notFound();
    return <Unavailable />;
  }

  const view = toDraftStudioView(drafted.value, organization.value.name, params.id);

  return (
    <section>
      <a href={view.backHref} className="text-sm text-accent">
        ← Back to federal opportunities
      </a>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Draft studio</h1>
      <p className="mt-1 text-sm text-muted">
        {view.opportunityNumber} · {view.opportunityTitle}
      </p>

      {/* The roadmap's "**and say so**". Rubric-conditioned and summary-conditioned prose read
          identically, so the basis is stated every time, not only when it is bad news. */}
      <p
        className={`mt-4 max-w-prose rounded border p-4 text-sm ${
          view.conditioning.kind === 'rubric'
            ? 'border-line bg-gray-50'
            : 'border-amber-300 bg-amber-50 text-amber-900'
        }`}
        data-testid="conditioning-note"
      >
        {view.conditioning.note}
      </p>

      {view.note === null ? null : (
        <p
          className="mt-3 max-w-prose rounded border border-line bg-gray-50 p-4 text-sm"
          data-testid="draft-note"
        >
          {view.note}
        </p>
      )}

      <p className="mt-4 max-w-prose text-sm text-muted">
        This is a first draft for a human to take over, not an application. Merit never submits anything and
        never contacts a funder.
      </p>

      {view.sections.length === 0 ? (
        <p
          className="mt-8 max-w-prose rounded border border-line bg-gray-50 p-4 text-sm"
          data-testid="empty-reason"
        >
          No draft could be written. The reason is stated above.
        </p>
      ) : (
        <>
          <h2 className="mt-10 text-xl font-semibold tracking-tight">The draft</h2>
          <DraftSections sections={view.sections} />
        </>
      )}

      <h2 className="mt-10 text-xl font-semibold tracking-tight">How it scores against the rubric</h2>

      {view.critiqueEmptyReason === null ? (
        <>
          <p className="mt-2 max-w-prose text-sm" data-testid="score-total">
            {view.totalAfter === null
              ? `Scored ${view.totalBefore}.`
              : `Scored ${view.totalBefore}, then ${view.totalAfter} after revision.`}
          </p>
          {view.revisionSummary === null ? null : (
            <p className="mt-1 max-w-prose text-sm text-muted" data-testid="revision-summary">
              {view.revisionSummary}
            </p>
          )}
          <p className="mt-2 max-w-prose text-xs text-muted">
            These scores are this system’s own reading of the announcement’s criteria, not a reviewer’s. Each
            one names the sentence it judged so you can check it.
          </p>

          <CriterionScores criteria={view.criteria} />

          {view.weakCriteria.length > 0 ? (
            <div className="mt-8 rounded border border-line p-5" data-testid="weak-criteria">
              <h3 className="font-medium">Where this draft is weakest</h3>
              <p className="mt-1 text-sm text-muted">
                Ordered by the points still unearned. This is what a human has to supply.
              </p>
              <ul className="mt-3 grid gap-3">
                {view.weakCriteria.map((weak) => (
                  <li key={weak.criterionName} className="border-l-2 border-line pl-3">
                    <p className="text-sm font-medium">{weak.criterionName}</p>
                    <p className="text-sm tabular-nums text-muted">{weak.pointsAtStake}</p>
                    <p className="mt-1 text-sm">{weak.whatToSupply}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p
          className="mt-2 max-w-prose rounded border border-line bg-gray-50 p-4 text-sm"
          data-testid="critique-empty-reason"
        >
          {view.critiqueEmptyReason}
        </p>
      )}
    </section>
  );
}

const Unavailable = () => (
  <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
    The database is unavailable, so no draft could be produced. Nothing was lost.
  </p>
);
