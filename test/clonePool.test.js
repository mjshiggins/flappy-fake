import { describe, it, expect } from 'vitest';
import { ClonePool } from '../src/main/clonePool.js';

describe('ClonePool', () => {
  it('constructs a fresh object when the pool is empty', () => {
    const pool = new ClonePool(() => ({ tag: 'new' }));
    expect(pool.acquire().tag).toBe('new');
    expect(pool.created).toBe(1);
  });

  it('reuses a released object instead of constructing', () => {
    const pool = new ClonePool(() => ({ tag: 'new' }));
    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();
    expect(b).toBe(a);
    expect(pool.created).toBe(1);
  });

  it('tracks outstanding objects so leaks are visible', () => {
    const pool = new ClonePool(() => ({}));
    const a = pool.acquire(); pool.acquire();
    expect(pool.outstanding).toBe(2);
    pool.release(a);
    expect(pool.outstanding).toBe(1);
  });
});
