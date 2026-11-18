import { describe, expect, it } from 'vitest';
import { dominant, fmtPx, isNearMiss } from '../../src/near-miss.js';

describe('isNearMiss', () => {
  const w = { min: 0.5, max: 4 };
  it('flags small non-zero differences', () => expect(isNearMiss(13, 16, w)).toBe(true));
  it('treats sub-pixel noise as equal', () => expect(isNearMiss(16.4, 16, w)).toBe(false));
  it('treats large differences as intentional', () => expect(isNearMiss(40, 16, w)).toBe(false));
  it('includes the max bound', () => expect(isNearMiss(20, 16, w)).toBe(true));
  it('applies maxRatio to the expected value', () =>
    expect(isNearMiss(5, 8, { min: 0.5, max: 4, maxRatio: 0.25 })).toBe(false)); // 3 > 2
});

describe('dominant', () => {
  it('finds the most common value', () => expect(dominant([16, 16, 14, 16])).toEqual({ value: 16, count: 3 }));
  it('groups values within tolerance', () => expect(dominant([16, 16.3, 12])).toEqual({ value: 16, count: 2 }));
  it('returns null on a tie', () => expect(dominant([16, 16, 14, 14])).toBeNull());
  it('returns null with no repeats', () => expect(dominant([10, 14])).toBeNull());
});

describe('fmtPx', () => {
  it('formats', () => expect([3, 2.5, 2.499, 0.25].map(fmtPx)).toEqual(['3px', '2.5px', '2.5px', '0.25px']));
});
