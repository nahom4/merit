import type { YearRowView } from '../view-model.js';

/**
 * The grantee list by year, with turnover as a series rather than a single number.
 *
 * A real table, because it is tabular data: a screen reader should be able to read "2022,
 * turnover 50%" as a row, and a development director should be able to copy it into a board
 * paper. The grantees behind each year are one disclosure away.
 */
export const YearTable = ({ rows }: { rows: readonly YearRowView[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[34rem] text-left text-sm" data-testid="grantees-by-year">
      <caption className="sr-only">
        This funder’s grantees by filing year, with turnover, new grantees, and amounts
      </caption>
      <thead>
        <tr className="border-b border-line text-muted">
          <th scope="col" className="py-1 pr-3 font-medium">
            Year
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            Grantees
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            New
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            Left
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            Turnover
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            Total
          </th>
          <th scope="col" className="py-1 font-medium">
            Median
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.year} className="border-b border-line/60 align-top">
            <th scope="row" className="py-2 pr-3 font-normal tabular-nums">
              {row.year}
            </th>
            <td className="py-2 pr-3 tabular-nums">
              <details>
                <summary className="cursor-pointer text-accent">{row.grantees}</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
                  {row.granteeNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </details>
            </td>
            <td className="py-2 pr-3 tabular-nums">{row.newGrantees}</td>
            <td className="py-2 pr-3 tabular-nums">{row.departed}</td>
            <td className="py-2 pr-3 tabular-nums text-muted">{row.turnover}</td>
            <td className="py-2 pr-3 tabular-nums">{row.total}</td>
            <td className="py-2 tabular-nums">{row.median}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
