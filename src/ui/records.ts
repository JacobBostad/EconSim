/**
 * records.ts — cross-town personal records (localStorage, UI-side only).
 *
 * Tracks lifetime bests across every town the player founds: fastest day to
 * reach Tycoon, highest valuation ever, most achievements in one town, and
 * towns founded. Shown in the New Game dialog as something to beat.
 */

export interface HallOfRecords {
  townsFounded: number;
  fastestTycoonDay: number | null;
  highestValuation: number;
  mostAchievements: number;
}

const KEY = 'econsim.records';

export function loadRecords(): HallOfRecords {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<HallOfRecords>;
      return {
        townsFounded: r.townsFounded ?? 0,
        fastestTycoonDay: r.fastestTycoonDay ?? null,
        highestValuation: r.highestValuation ?? 0,
        mostAchievements: r.mostAchievements ?? 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { townsFounded: 0, fastestTycoonDay: null, highestValuation: 0, mostAchievements: 0 };
}

function save(r: HallOfRecords): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

export function recordTownFounded(): void {
  const r = loadRecords();
  r.townsFounded += 1;
  save(r);
}

/** Called periodically with current-town stats; keeps lifetime maxima. */
export function updateRecords(input: {
  day: number;
  valuation: number;
  achievements: number;
  tycoonReached: boolean;
}): void {
  const r = loadRecords();
  let dirty = false;
  if (input.valuation > r.highestValuation) {
    r.highestValuation = input.valuation;
    dirty = true;
  }
  if (input.achievements > r.mostAchievements) {
    r.mostAchievements = input.achievements;
    dirty = true;
  }
  if (
    input.tycoonReached &&
    (r.fastestTycoonDay === null || input.day < r.fastestTycoonDay)
  ) {
    r.fastestTycoonDay = input.day;
    dirty = true;
  }
  if (dirty) save(r);
}

// ---------------------------------------------------------------------------
// Challenge leaderboard (completed day-200 runs)
// ---------------------------------------------------------------------------

export interface ChallengeRun {
  score: number;
  valuation: number;
  scenarioId: string;
  difficulty: string;
  seed: number;
  /** ISO date the run finished (wall clock, UI-side only). */
  at: string;
}

const CHALLENGE_KEY = 'econsim.challenges';
const MAX_CHALLENGE_RUNS = 50;

export function loadChallengeRuns(): ChallengeRun[] {
  try {
    const raw = localStorage.getItem(CHALLENGE_KEY);
    if (raw) return JSON.parse(raw) as ChallengeRun[];
  } catch {
    /* ignore */
  }
  return [];
}

/** Store a finished run; keeps the list sorted by score, capped. */
export function recordChallengeRun(run: ChallengeRun): void {
  const runs = loadChallengeRuns();
  runs.push(run);
  runs.sort((a, b) => b.score - a.score);
  runs.length = Math.min(runs.length, MAX_CHALLENGE_RUNS);
  try {
    localStorage.setItem(CHALLENGE_KEY, JSON.stringify(runs));
  } catch {
    /* ignore */
  }
}
