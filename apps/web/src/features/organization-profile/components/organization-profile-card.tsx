import type { OrganizationProfileView } from '../view-model.js';

/** Presentational: props in, JSX out. Every string it renders was formatted by the view-model. */
export const OrganizationProfileCard = ({ profile }: { profile: OrganizationProfileView }) => (
  <article className="panel overflow-hidden">
    <div className="border-b border-line/70 bg-[linear-gradient(135deg,rgba(15,118,110,0.14),rgba(255,255,255,0.94))] p-6 sm:p-8">
      <span className="soft-label">Organisation profile</span>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">{profile.name}</h1>
      <p className="mt-2 text-base text-muted">{profile.location}</p>
    </div>

    <dl className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
      <div className="rounded-2xl border border-line/70 bg-white/90 p-4">
        <dt className="text-xs uppercase tracking-[0.2em] text-muted">EIN</dt>
        <dd className="mt-1 text-base font-medium" data-testid="profile-ein">
          {profile.ein}
        </dd>
      </div>
      <div className="rounded-2xl border border-line/70 bg-white/90 p-4">
        <dt className="text-xs uppercase tracking-[0.2em] text-muted">Program area</dt>
        <dd className="mt-1 text-base font-medium" data-testid="profile-program-area">
          {profile.programArea}
        </dd>
      </div>
      <div className="rounded-2xl border border-line/70 bg-white/90 p-4">
        <dt className="text-xs uppercase tracking-[0.2em] text-muted">Annual revenue</dt>
        <dd className="mt-1 text-base font-medium" data-testid="profile-revenue">
          {profile.annualRevenue}
        </dd>
      </div>
      <div className="rounded-2xl border border-line/70 bg-white/90 p-4">
        <dt className="text-xs uppercase tracking-[0.2em] text-muted">Materiality floor</dt>
        <dd className="mt-1 text-base font-medium" data-testid="profile-materiality-floor">
          {profile.materialityFloor}
        </dd>
        <p className="mt-2 text-xs leading-6 text-muted">
          Funders whose median grant falls below this are excluded: the application would cost more than the
          grant is worth.
        </p>
      </div>
      <div className="sm:col-span-2 rounded-2xl border border-line/70 bg-white/90 p-4">
        <dt className="text-xs uppercase tracking-[0.2em] text-muted">Funding region</dt>
        <dd className="mt-1 text-base font-medium" data-testid="profile-region">
          {profile.region}
        </dd>
        <p className="mt-2 text-xs leading-6 text-muted">
          A funder in any of these states counts as local. Foundations give near home, and a state line is not
          a wall.
        </p>
      </div>
    </dl>
  </article>
);
