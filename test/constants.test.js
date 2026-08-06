import { describe, it, expect } from 'vitest';
import { DT, D, R, K, PIPE_SPACING, HALF_GAP_FLOOR } from '../src/shared/constants.js';

describe('constants', () => {
  it('uses the verified timestep, not the 0.05 that was wrong', () => {
    expect(DT).toBeCloseTo(1 / 120, 10);
  });

  it('satisfies the horizon invariant R <= D - PIPE_SPACING', () => {
    expect(R).toBeLessThanOrEqual(D - PIPE_SPACING);
  });

  it('has a horizon covering at least one full pipe spacing', () => {
    expect(D).toBeGreaterThanOrEqual(PIPE_SPACING);
  });

  it('exposes the measured difficulty floor', () => {
    expect(HALF_GAP_FLOOR).toBe(246415);
    expect(PIPE_SPACING).toBe(201);
    expect(K).toBeGreaterThan(0);
  });
});
