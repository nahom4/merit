export default function OrganizationNotFound() {
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">No such organisation</h1>
      <p className="mt-2 text-muted">
        That profile is not on file. It may have been created against a different database.
      </p>
      <a href="/organizations/new" className="mt-4 inline-block text-accent underline">
        Create a profile
      </a>
    </section>
  );
}
