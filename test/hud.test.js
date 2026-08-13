import { describe, it, expect } from 'vitest';
import { formatHudBody } from '../src/main/hud.js';

describe('formatHudBody', () => {
  it('always renders four rows so the panel does not resize', () => {
    const text = formatHudBody({ replans: 0, exhaustedReplans: 0, narrowedReplans: 0, driftEvents: 0 });
    expect(text.split('\n')).toHaveLength(4);
    expect(text).toMatch(/death\s+—/);
  });

  it('shows exhaustion and narrowing rates from the run', () => {
    const text = formatHudBody({
      replans: 2208, exhaustedReplans: 1114, narrowedReplans: 1753, driftEvents: 0,
    });
    expect(text).toMatch(/replans\s+2208/);
    expect(text).toMatch(/exhaust\s+1114 \(50%\)/);
    expect(text).toMatch(/narrow\s+1753 \(79%\)/);
  });

  it('shows the frozen death cause after a crash', () => {
    const text = formatHudBody({
      replans: 10, exhaustedReplans: 0, narrowedReplans: 0, driftEvents: 0,
      deathCause: 'pipeTop',
    });
    expect(text).toMatch(/death\s+pipeTop/);
  });
});
