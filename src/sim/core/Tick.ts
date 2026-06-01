/**
 * Tick.ts — In-game time model and helpers.
 *
 * Time is measured in integer ticks since the start of the game. Everything
 * else (hour, day, day-of-week) is derived from the tick count and config so
 * there is a single source of truth.
 */

import type { SimulationConfig } from './SimulationConfig';

export interface GameTime {
  /** Total ticks elapsed. */
  tick: number;
  /** Days elapsed (0-based). */
  day: number;
  /** Hour of the current day (0..23). */
  hour: number;
  /** Tick index within the current day. */
  tickOfDay: number;
  /** Day of week (0..6). */
  dayOfWeek: number;
}

export function ticksPerDay(config: SimulationConfig): number {
  return config.ticksPerHour * 24;
}

export function computeTime(tick: number, config: SimulationConfig): GameTime {
  const tpd = ticksPerDay(config);
  const day = Math.floor(tick / tpd);
  const tickOfDay = tick % tpd;
  const hour = Math.floor(tickOfDay / config.ticksPerHour);
  return { tick, day, hour, tickOfDay, dayOfWeek: day % 7 };
}

/** True on the first tick of a new day (excluding tick 0). */
export function isDayBoundary(tick: number, config: SimulationConfig): boolean {
  return tick > 0 && tick % ticksPerDay(config) === 0;
}

/** True on the first tick of a new hour. */
export function isHourBoundary(tick: number, config: SimulationConfig): boolean {
  return tick % config.ticksPerHour === 0;
}
