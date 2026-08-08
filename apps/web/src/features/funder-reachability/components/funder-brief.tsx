import type { BriefClaimView } from '../view-model.js';

/**
 * The brief: every claim with its source beside it, and an explicit statement of what the
 * evidence does not support.
 *
 * The citation is not a tooltip or a footnote marker. It is rendered next to the sentence it
 * supports, because a development director has to be able to check the claim rather than
 * trust it -- and because a claim whose citation is hidden is, in practice, an uncited claim.
 */
export const FunderBrief = ({
  claims,
  limitations,
}: {
  claims: readonly BriefClaimView[];
  limitations: readonly string[];
}) => (
  <section data-testid="funder-brief">
    <h2 className="text-lg font-semibold tracking-tight">Brief</h2>

    <ul className="mt-3 grid gap-4">
      {claims.map((claim) => (
        <li
          key={claim.id}
          className="rounded-2xl border border-line/70 bg-white/90 p-4"
          data-testid="brief-claim"
        >
          <p className="max-w-prose text-sm">{claim.statement}</p>
          <ul className="mt-1 grid gap-0.5">
            {claim.citations.map((citation) => (
              <li key={citation} className="text-xs text-muted" data-testid="brief-citation">
                Source: {citation}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>

    <h3 className="mt-8 text-sm font-semibold tracking-tight">What this evidence does not support</h3>
    <ul
      className="mt-2 grid max-w-prose list-disc gap-2 pl-5 text-sm text-muted"
      data-testid="brief-limitations"
    >
      {limitations.map((limitation) => (
        <li key={limitation}>{limitation}</li>
      ))}
    </ul>
  </section>
);
