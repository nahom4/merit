export type MilestoneKind = 'draft_complete' | 'board_signoff' | 'letters_requested' | 'final_review';

export interface PlannedMilestone {
  readonly kind: MilestoneKind;
  readonly label: string;
  readonly dueDate: string;
}

const MILESTONES: readonly { readonly kind: MilestoneKind; readonly label: string; readonly offsetDays: number }[] =
  [
    { kind: 'draft_complete', label: 'Draft complete', offsetDays: 21 },
    { kind: 'board_signoff', label: 'Board sign-off', offsetDays: 14 },
    { kind: 'letters_requested', label: 'Letters of support requested', offsetDays: 7 },
    { kind: 'final_review', label: 'Final review', offsetDays: 2 },
  ];

const DAY_MS = 24 * 60 * 60 * 1000;

const parseDate = (isoDate: string): Date => new Date(`${isoDate}T00:00:00.000Z`);
const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

/**
 * Backward-planned milestones for a pursuit. Milestones are clamped to "today" rather than
 * allowed to drift into the past when the deadline is close, because a past milestone is a
 * promise the system cannot keep.
 */
export const buildMilestones = (deadline: string, now: string): readonly PlannedMilestone[] => {
  const deadlineDate = parseDate(deadline);
  const floor = parseDate(now);

  return MILESTONES.map((milestone) => {
    const planned = addDays(deadlineDate, -milestone.offsetDays);
    const dueDate = planned < floor ? floor : planned;
    return { kind: milestone.kind, label: milestone.label, dueDate: toIsoDate(dueDate) };
  });
};
