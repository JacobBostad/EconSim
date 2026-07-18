/**
 * SimulationConfig.ts — Tunable simulation constants.
 *
 * Config is part of GameState so it survives save/load and keeps the engine
 * data-driven. Defaults are chosen so the starting scenario is immediately
 * playable and the economy moves quickly.
 */

export type Difficulty = 'relaxed' | 'standard' | 'brutal';

export interface SimulationConfig {
  /** Chosen difficulty preset (informational; the knobs below carry the effect). */
  difficulty: Difficulty;
  /** Challenge run: the game ends with a final score at day 200. */
  challengeMode: boolean;
  /** Player starting cash (cents). */
  playerStartCash: number;
  /** Chance per day that a new world event starts (see WorldEventSystem). */
  worldEventDailyChance: number;
  /** Chance per eligible day that an AI firm opens a new outlet. */
  aiExpandChance: number;

  /** Ticks per in-game hour. Day length = ticksPerHour * 24. */
  ticksPerHour: number;
  /** Citizen movement speed in map units per tick. */
  citizenSpeed: number;
  /** Vehicle movement speed in map units per tick. */
  vehicleSpeed: number;

  /** Work day start/end hours (24h). */
  workStartHour: number;
  workEndHour: number;
  /** Shopping window (24h). Urgent needs can still shop outside it. */
  shopStartHour: number;
  shopEndHour: number;
  /** Hours during which retail stores are open and can serve customers. */
  storeOpenHour: number;
  storeCloseHour: number;

  /** Payroll interval in days (1 = daily, 7 = weekly). */
  payrollIntervalDays: number;
  /**
   * Subsistence income (cents/day) paid to unemployed citizens from the world
   * account. Models savings/informal work/welfare so the consumer economy keeps
   * functioning at high unemployment. Set to 0 for a harsher simulation.
   */
  subsistenceIncomePerDay: number;

  /** Need urgency threshold above which a citizen wants to shop. */
  needUrgencyThreshold: number;
  /** Urgency at/above which a need is "urgent" and may shop off-hours. */
  needUrgentThreshold: number;
  /** Max distance (map units) a citizen will travel to shop. */
  maxShoppingDistance: number;
  /** Seeded random weight applied to store scores (exploration). */
  storeScoreJitter: number;
  /** Minimum ticks between a citizen's shopping trips (prevents thrashing). */
  shoppingCooldownTicks: number;

  /** Days a firm may stay cash-negative before becoming distressed. */
  distressGraceDays: number;
  /** Days insolvent before facilities begin closing. */
  insolvencyCloseDays: number;

  /** AI price step bounds. */
  aiPriceStepMin: number; // e.g. 0.02
  aiPriceStepMax: number; // e.g. 0.05
  /** AI keeps price within [min, max] * basePrice. */
  aiPriceFloorMult: number;
  aiPriceCeilMult: number;

  /** Bounded log sizes. */
  maxEvents: number;
  maxTransactions: number;
  maxDailyHistory: number;

  /** Map dimensions in units. */
  mapWidth: number;
  mapHeight: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  difficulty: 'standard',
  challengeMode: false,
  playerStartCash: 15000 * 100,
  worldEventDailyChance: 0.2,
  aiExpandChance: 0.5,

  ticksPerHour: 2, // 48 ticks/day
  citizenSpeed: 6,
  vehicleSpeed: 4,

  workStartHour: 8,
  workEndHour: 16,
  shopStartHour: 16,
  shopEndHour: 21,
  storeOpenHour: 8,
  storeCloseHour: 22,

  payrollIntervalDays: 1,
  subsistenceIncomePerDay: 1400, // $14.00/day — keeps consumption flowing

  needUrgencyThreshold: 0.5,
  needUrgentThreshold: 1.1,
  maxShoppingDistance: 95,
  storeScoreJitter: 0.06,
  shoppingCooldownTicks: 6, // ~3 in-game hours at default tick rate

  distressGraceDays: 3,
  insolvencyCloseDays: 10,

  aiPriceStepMin: 0.02,
  aiPriceStepMax: 0.05,
  aiPriceFloorMult: 0.6,
  aiPriceCeilMult: 1.5,

  maxEvents: 400,
  maxTransactions: 4000,
  maxDailyHistory: 120,

  mapWidth: 130,
  mapHeight: 92,
};

/** Difficulty presets: starting capital, news volatility, AI aggressiveness. */
export function configForDifficulty(difficulty: Difficulty): SimulationConfig {
  switch (difficulty) {
    case 'relaxed':
      return {
        ...DEFAULT_CONFIG,
        difficulty,
        playerStartCash: 25000 * 100,
        worldEventDailyChance: 0.12,
        aiExpandChance: 0.35,
      };
    case 'brutal':
      return {
        ...DEFAULT_CONFIG,
        difficulty,
        playerStartCash: 9000 * 100,
        worldEventDailyChance: 0.3,
        aiExpandChance: 0.7,
      };
    default:
      return { ...DEFAULT_CONFIG, difficulty: 'standard' };
  }
}
