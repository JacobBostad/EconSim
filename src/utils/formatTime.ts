/** formatTime — display helpers for in-game time. */

import type { GameTime } from '../sim/core/Tick';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function formatTime(time: GameTime): string {
  const hh = time.hour.toString().padStart(2, '0');
  return `Day ${time.day + 1} (${DAY_NAMES[time.dayOfWeek]}) ${hh}:00`;
}

export function formatClock(time: GameTime): string {
  return `${time.hour.toString().padStart(2, '0')}:00`;
}
