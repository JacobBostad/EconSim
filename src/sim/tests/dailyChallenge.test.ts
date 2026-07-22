import { describe, it, expect } from 'vitest';
import { dailySeed, dailyDateFromSeed, challengeShareText } from '../../ui/records';

describe('Daily challenge seed', () => {
  it('is a pure function of the UTC date — same day, same seed, worldwide', () => {
    expect(dailySeed(new Date(Date.UTC(2026, 6, 18, 0, 0, 1)))).toBe(20260718);
    expect(dailySeed(new Date(Date.UTC(2026, 6, 18, 23, 59, 59)))).toBe(20260718);
    expect(dailySeed(new Date(Date.UTC(2026, 6, 19)))).toBe(20260719);
    expect(dailySeed(new Date(Date.UTC(2030, 0, 1)))).toBe(20300101);
  });

  it('daily seeds are recognizable from the leaderboard, others are not', () => {
    expect(dailyDateFromSeed(20260718)).toBe('2026-07-18');
    expect(dailyDateFromSeed(42)).toBeNull();
    expect(dailyDateFromSeed(123456)).toBeNull();
    expect(dailyDateFromSeed(20269901)).toBeNull(); // month 99
    expect(dailyDateFromSeed(20260732)).toBeNull(); // day 32
  });

  it('the share string brags about the daily when the seed encodes one', () => {
    const base = { score: 700, valuation: 5000000, scenarioId: 'meadowbrook', difficulty: 'standard', world: 'village' as const, at: '2026-07-18' };
    expect(challengeShareText({ ...base, seed: 20260718 }, 'Meadowbrook')).toContain('Daily Challenge 2026-07-18');
    expect(challengeShareText({ ...base, seed: 42 }, 'Meadowbrook')).toContain('seed 42');
  });
});
