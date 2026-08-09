import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Finds an announcement on the federal board, whichever page it landed on.
 *
 * The board sorts by usefulness -- scored first, then queued, then screened out -- and paginates
 * at ten. Anything screened out is therefore on the last page, and it moves further back every
 * time a new announcement is recorded into the fixture set. A test that asserts against page one
 * is asserting about the size of that fixture set rather than about the behaviour it names.
 *
 * Pages are walked by URL rather than by clicking "Next". Every board load re-screens all
 * announcements and scores a few more of them, so a click waits on work that grows with the
 * corpus; a direct navigation waits on one page load and nothing else.
 */
const MAX_PAGES = 20;

export const boardRow = async (
  page: Page,
  organizationUrl: string,
  opportunityNumber: string,
): Promise<Locator> => {
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    await page.goto(`${organizationUrl}/opportunities?page=${pageNumber}`);

    const rows = page.getByTestId('opportunity-row');
    await expect(rows.first()).toBeVisible();

    const match = rows.filter({ hasText: opportunityNumber });
    if ((await match.count()) > 0) return match;

    const pagination = page.getByTestId('pagination');
    // One page of results renders no pagination at all, which is also the end of the walk.
    if ((await pagination.count()) === 0) break;
    if (!(await pagination.innerText()).includes(`Page ${pageNumber} of `)) break;
    const [, last] = /Page \d+ of (\d+)/.exec(await pagination.innerText()) ?? [];
    if (last !== undefined && pageNumber >= Number(last)) break;
  }

  throw new Error(`no row for ${opportunityNumber} on any page of the federal board`);
};
