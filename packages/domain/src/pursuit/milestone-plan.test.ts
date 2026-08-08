import { describe, expect, it } from 'vitest';
import { buildMilestones } from './milestone-plan.js';

describe('buildMilestones', () => {
  it('plans milestones backward from the deadline', () => {
    const milestones = buildMilestones('2026-09-30', '2026-08-08');

    expect(milestones.map((milestone) => milestone.kind)).toEqual([
      'draft_complete',
      'board_signoff',
      'letters_requested',
      'final_review',
    ]);
    expect(milestones.map((milestone) => milestone.dueDate)).toEqual([
      '2026-09-09',
      '2026-09-16',
      '2026-09-23',
      '2026-09-28',
    ]);
  });

  it('clamps dates that would fall in the past', () => {
    const milestones = buildMilestones('2026-08-11', '2026-08-08');

    expect(milestones.every((milestone) => milestone.dueDate >= '2026-08-08')).toBe(true);
    expect(milestones[milestones.length - 1]?.dueDate).toBe('2026-08-09');
  });
});
