import type { FinancialTrendView } from '../view-model.js';

/**
 * The funder's own finances, from ProPublica.
 *
 * The unavailable branch is a designed state, not a fallback: ProPublica is the one runtime
 * dependency this page has that can be down, and the page must say which section is missing
 * rather than quietly rendering nothing where a trend should be.
 */
export const FinancialTrend = ({
  trend,
  unavailable,
}: {
  trend: FinancialTrendView | null;
  unavailable: string | null;
}) => (
  <section className="mt-10" data-testid="financial-trend">
    <h2 className="text-lg font-semibold tracking-tight">Financial trend and capacity</h2>

    {trend === null ? (
      <p
        className="mt-3 max-w-prose rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        data-testid="financials-unavailable"
      >
        {unavailable}
      </p>
    ) : (
      <>
        <p className="mt-1 max-w-prose text-sm">{trend.summary}</p>
        <p className="mt-1 max-w-prose text-sm text-muted">{trend.payout}</p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">
              This funder’s reported revenue, expenses, assets, and grants paid by year
            </caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Year
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Return
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Revenue
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Expenses
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Assets
                </th>
                <th scope="col" className="py-1 font-medium">
                  Grants paid
                </th>
              </tr>
            </thead>
            <tbody>
              {trend.rows.map((row) => (
                <tr key={row.year} className="border-b border-line/60">
                  <th scope="row" className="py-1 pr-3 font-normal tabular-nums">
                    {row.year}
                  </th>
                  <td className="py-1 pr-3 text-muted">{row.form}</td>
                  <td className="py-1 pr-3 tabular-nums">{row.revenue}</td>
                  <td className="py-1 pr-3 tabular-nums">{row.expenses}</td>
                  <td className="py-1 pr-3 tabular-nums">{row.assets}</td>
                  <td className="py-1 tabular-nums">{row.grantsPaid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {trend.note === null ? null : <p className="mt-2 max-w-prose text-xs text-muted">{trend.note}</p>}
      </>
    )}
  </section>
);
