import type { AffinityView } from '../view-model.js';

/**
 * Shared-funder proximity, labelled as exactly that.
 *
 * The disclaimer is rendered before the paths, not beneath them in small print. A development
 * director reading this must not come away thinking they know somebody here: the product rules
 * are explicit that this is never presented as a personal connection.
 */
export const AffinityPaths = ({ affinity }: { affinity: AffinityView }) => (
  <section data-testid="affinity-paths">
    <h2 className="text-lg font-semibold tracking-tight">Proximity</h2>

    <p className="mt-1 max-w-prose text-sm leading-7">
      This section shows <strong>{affinity.label}</strong>. {affinity.disclaimer}
    </p>

    <p className="mt-3 text-sm text-muted">{affinity.summary}</p>

    {affinity.emptyReason === null ? (
      <ul className="mt-4 grid gap-3">
        {affinity.paths.map((path) => (
          <li key={path.grantee} className="rounded-2xl border border-line/70 bg-white/90 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{path.grantee}</h3>
              <span className="text-xs text-muted">{path.location}</span>
            </div>
            <div
              className="mt-2 h-2 w-full rounded bg-line"
              role="meter"
              aria-label={`Proximity strength for ${path.grantee}`}
              aria-valuenow={path.strengthPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-2 rounded bg-accent" style={{ width: `${path.strengthPercent}%` }} />
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-muted">
              {path.via.map((via) => (
                <li key={via}>{via}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    ) : (
      <p
        className="mt-4 max-w-prose rounded border border-line bg-gray-50 p-4 text-sm"
        data-testid="affinity-empty"
      >
        {affinity.emptyReason}
      </p>
    )}
  </section>
);
