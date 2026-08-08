import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Merit',
};

const capabilities = [
  {
    title: 'Prospect discovery',
    body: 'Turn a nonprofit profile into a ranked list of credible funders, with four transparent score components and evidence rows you can open.',
  },
  {
    title: 'Reachability reports',
    body: 'Open any funder and see whether it is worth the effort: grant history, ask calibration, geography, proximity, and a brief with citations on every claim.',
  },
  {
    title: 'Federal screening',
    body: 'Scan opportunities, reject ineligible announcements before any model call, and keep fit scoring tied to matched program areas and explicit gaps.',
  },
  {
    title: 'Draft studio',
    body: 'Generate a draft beside its rubric, then revise and critique it with the weak criteria and supporting sentences called out on screen.',
  },
];

const steps = [
  'Create an organisation profile with name, EIN, state, program code, and revenue.',
  'See comparable funders ranked by openness, affinity, geography, and size fit.',
  'Open a funder report to inspect the filings behind each recommendation.',
  'Move into federal opportunities and draft against the announcements that actually fit.',
];

export default function HomePage() {
  return (
    <div className="grid gap-8 lg:gap-10">
      <section className="shell-card overflow-hidden px-6 py-8 sm:px-10 sm:py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-center">
          <div>
            <span className="soft-label">Current slice: S5</span>
            <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[0.95] tracking-tight text-ink sm:text-6xl">
              One profile in.
              <br />
              Funders, federal opportunities, and drafts out.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
              Merit helps small nonprofits move from a basic organisation profile to a usable fundraising
              workflow: discover credible foundation prospects, inspect the filings behind the rankings,
              screen federal opportunities, and draft from the evidence that is already on file.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/organizations/new"
                className="rounded-full bg-ink px-5 py-3 font-medium text-white shadow-lg shadow-emerald-950/10 transition hover:bg-accentStrong"
              >
                Create a profile
              </Link>
              <a
                href="#capabilities"
                className="rounded-full border border-line bg-white/80 px-5 py-3 font-medium text-ink transition hover:border-accent hover:text-accent"
              >
                Explore capabilities
              </a>
            </div>
          </div>

          <div className="panel p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted">What you get</p>
            <div className="mt-5 grid gap-4">
              {[
                ['Prospect list', 'Four bars per funder, not one score.'],
                ['Reachability report', 'A decision aid with citations on every claim.'],
                ['Federal board', 'Eligibility first, model calls only when needed.'],
                ['Draft studio', 'Draft, critique, and revise against a rubric.'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-line/70 bg-white p-4">
                  <div className="text-sm font-medium text-muted">{label}</div>
                  <div className="mt-1 text-base font-medium text-ink">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="capabilities" className="grid gap-5 md:grid-cols-2">
        {capabilities.map((capability, index) => (
          <article key={capability.title} className="panel p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="soft-label">0{index + 1}</span>
              <span className="text-xs uppercase tracking-[0.24em] text-muted">Available now</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">{capability.title}</h2>
            <p className="mt-3 text-sm leading-7 text-muted">{capability.body}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="panel p-6">
          <p className="soft-label">Workflow</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">From profile to action in four steps</h2>
          <ol className="mt-6 grid gap-4">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-4 rounded-2xl border border-line/70 bg-white p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accentSoft text-sm font-semibold text-accentStrong">
                  {index + 1}
                </span>
                <p className="pt-1 text-sm leading-7 text-muted">{step}</p>
              </li>
            ))}
          </ol>
        </div>

        <aside className="panel p-6">
          <p className="soft-label">Start here</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">Build the profile first</h2>
          <p className="mt-3 text-sm leading-7 text-muted">
            The organisation profile is the anchor for every ranking, report, and draft. Once it exists, Merit
            can immediately show nearby funders and the federal board for that same organisation.
          </p>
          <Link
            href="/organizations/new"
            className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-accent px-5 py-3 font-medium text-white transition hover:bg-accentStrong"
          >
            Create an organisation profile
          </Link>
        </aside>
      </section>
    </div>
  );
}
