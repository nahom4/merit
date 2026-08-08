import type { OrganizationProfileView } from '../view-model.js';

/** Presentational: props in, JSX out. Every string it renders was formatted by the view-model. */
export const OrganizationProfileCard = ({ profile }: { profile: OrganizationProfileView }) => (
  <article className="rounded border border-line p-6">
    <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
    <p className="mt-1 text-muted">{profile.location}</p>

    <dl className="mt-6 grid gap-4 sm:grid-cols-2">
      <div>
        <dt className="text-sm text-muted">EIN</dt>
        <dd data-testid="profile-ein">{profile.ein}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted">Program area</dt>
        <dd data-testid="profile-program-area">{profile.programArea}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted">Annual revenue</dt>
        <dd data-testid="profile-revenue">{profile.annualRevenue}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted">Materiality floor</dt>
        <dd data-testid="profile-materiality-floor">{profile.materialityFloor}</dd>
        <p className="mt-1 text-xs text-muted">
          Funders whose median grant falls below this are excluded: the application would cost more than the
          grant is worth.
        </p>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-sm text-muted">Funding region</dt>
        <dd data-testid="profile-region">{profile.region}</dd>
        <p className="mt-1 text-xs text-muted">
          A funder in any of these states counts as local. Foundations give near home, and a state line is not
          a wall.
        </p>
      </div>
    </dl>
  </article>
);
