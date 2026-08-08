import type { DraftSectionView } from '../view-model.js';

/**
 * The draft, each section beside the sub-criteria it was written to answer.
 *
 * The bracketed placeholders are pulled out of the prose and listed under it. Drafting is told
 * to bracket any fact the profile does not contain rather than invent one, and a placeholder
 * buried in the fourth paragraph of a section is a placeholder that gets submitted.
 */
export const DraftSections = ({ sections }: { sections: readonly DraftSectionView[] }) => (
  <div className="mt-4 grid gap-6">
    {sections.map((section) => (
      <article key={section.heading} className="rounded border border-line p-5" data-testid="draft-section">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-medium tracking-tight">{section.heading}</h3>
          {section.wasRevised ? (
            <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Revised</span>
          ) : null}
        </div>

        <div className="mt-3 grid gap-5 lg:grid-cols-[2fr_1fr]">
          <div className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="section-text">
            {section.text}
          </div>

          <aside className="text-sm" data-testid="section-criteria">
            <h4 className="text-xs uppercase tracking-wide text-muted">What this is scored against</h4>
            {section.subCriteria.length > 0 ? (
              <ul className="mt-2 grid gap-1.5 text-muted">
                {section.subCriteria.map((sub) => (
                  <li key={sub} className="border-l-2 border-line pl-3">
                    {sub}
                  </li>
                ))}
              </ul>
            ) : null}
            {section.subCriteriaNote === null ? null : (
              <p className="mt-2 text-xs text-muted">{section.subCriteriaNote}</p>
            )}
          </aside>
        </div>

        {section.placeholders.length > 0 ? (
          <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3" data-testid="placeholders">
            <h4 className="text-sm font-medium text-amber-900">You have to supply these</h4>
            <p className="mt-1 text-xs text-amber-900">
              The draft left these blank on purpose rather than inventing them.
            </p>
            <ul className="mt-2 grid gap-1 text-sm text-amber-900">
              {section.placeholders.map((placeholder) => (
                <li key={placeholder}>{placeholder}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>
    ))}
  </div>
);
