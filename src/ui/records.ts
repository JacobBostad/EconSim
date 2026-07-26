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

/** World scale a challenge run was played at — leaderboards key on this. */
export type ChallengeWorld = 'village' | 'city' | 'metropolis';

export const CHALLENGE_WORLDS: ChallengeWorld[] = ['village', 'city', 'metropolis'];

/** Display name for a world scale (used in the share summary and the board). */
export function challengeWorldLabel(world: ChallengeWorld): string {
  return world === 'city' ? 'City' : world === 'metropolis' ? 'Metropolis' : 'Village';
}

export interface ChallengeRun {
  score: number;
  valuation: number;
  scenarioId: string;
  difficulty: string;
  seed: number;
  /**
   * World scale the run was played at. A Village 200-day score and a City one
   * are different games (a City run carries the whole era economy — crowd
   * demand, rent, seats, dividends, pool exports), so runs are leaderboarded
   * SEPARATELY per world. Legacy runs (all Village, recorded before the
   * world-scale era) have no field and read as 'village'.
   */
  world: ChallengeWorld;
  /** ISO date the run finished (wall clock, UI-side only). */
  at: string;
}

// The Village board keeps the original key untouched, so every pre-world-scale
// score survives byte-for-byte with no migration; City/Metropolis get their own
// slots (the named-save-slot idiom, `${KEY}.${world}`). A run is stored in and
// read from the slot for its own world only — the boards never mix.
const CHALLENGE_KEY = 'econsim.challenges';
const MAX_CHALLENGE_RUNS = 50;

function challengeKey(world: ChallengeWorld): string {
  return world === 'village' ? CHALLENGE_KEY : `${CHALLENGE_KEY}.${world}`;
}

export function loadChallengeRuns(world: ChallengeWorld = 'village'): ChallengeRun[] {
  try {
    const raw = localStorage.getItem(challengeKey(world));
    if (raw) {
      const runs = JSON.parse(raw) as ChallengeRun[];
      // Stamp the world onto legacy entries (the Village board predates the
      // field) so display and share text read a world for every run.
      return runs.map((r) => ({ ...r, world: r.world ?? world }));
    }
  } catch {
    /* ignore */
  }
  return [];
}

/** Store a finished run in its world's board; keeps the list sorted, capped. */
export function recordChallengeRun(run: ChallengeRun): void {
  const runs = loadChallengeRuns(run.world);
  runs.push(run);
  runs.sort((a, b) => b.score - a.score);
  runs.length = Math.min(runs.length, MAX_CHALLENGE_RUNS);
  try {
    localStorage.setItem(challengeKey(run.world), JSON.stringify(runs));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Daily challenge — a shared seed derived from the UTC calendar date, so
// every player worldwide races the SAME deterministic town that day. The
// engine's determinism makes this serverless: same seed + standard settings
// replay identically for everyone. The seed IS the date (YYYYMMDD), so a
// leaderboard entry can be recognized as a daily run from its seed alone.
// ---------------------------------------------------------------------------

/** Today's (or any date's) shared seed: UTC YYYYMMDD as a number. */
export function dailySeed(date: Date): number {
  return (
    date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
  );
}

/** If a seed encodes a plausible daily-challenge date, its ISO label. */
export function dailyDateFromSeed(seed: number): string | null {
  if (!Number.isInteger(seed) || seed < 2024_00_00 || seed > 2099_12_31) return null;
  const y = Math.floor(seed / 10000);
  const m = Math.floor((seed % 10000) / 100);
  const d = seed % 100;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Compact, paste-anywhere summary of a challenge run — a deterministic dare.
 * The world scale is named because a Village and a City score are different
 * games with their own boards; the seed still makes the run replayable. */
export function challengeShareText(run: ChallengeRun, scenarioName: string): string {
  const daily = dailyDateFromSeed(run.seed);
  const world = challengeWorldLabel(run.world ?? 'village');
  return [
    daily
      ? `📅 EconSim Daily Challenge ${daily} — ${scenarioName} · ${world} · ${run.difficulty}`
      : `🏁 EconSim Challenge — ${scenarioName} · ${world} · ${run.difficulty} · seed ${run.seed}`,
    `Score ${run.score}/1000 · valuation $${(run.valuation / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
    daily
      ? `Everyone races the same ${world} town today — beat me.`
      : `Same seed + scenario + world + difficulty replays identically — beat me.`,
  ].join('\n');
}
