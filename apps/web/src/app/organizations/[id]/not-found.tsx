import Link from 'next/link';

export default function OrganizationNotFound() {
  return (
    <section className="shell-card max-w-2xl p-6 sm:p-8">
      <span className="soft-label">Not found</span>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">No such organisation</h1>
      <p className="mt-3 max-w-prose text-base leading-8 text-muted">
        That profile is not on file. It may have been created against a different database.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/organizations/new" className="rounded-full bg-ink px-4 py-2 font-medium text-white">
          Create a profile
        </Link>
        <Link href="/" className="rounded-full border border-line bg-white/80 px-4 py-2 font-medium text-ink">
          Go home
        </Link>
      </div>
    </section>
  );
}
