/**
 * migrations.ts — forward-migrate older saves to the current SAVE_VERSION.
 *
 * Each migration takes the raw parsed object at version N and returns version
 * N+1. Add a new entry whenever GameState's shape changes in a breaking way.
 */

import { SAVE_VERSION } from '../core/GameState';
import type { GameState } from '../core/GameState';

type Raw = Record<string, unknown>;

const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  // Example for the future:
  // 1: (raw) => ({ ...raw, saveVersion: 2, newField: defaultValue }),
};

export function migrate(raw: Raw): GameState {
  let current = raw;
  let version = typeof raw.saveVersion === 'number' ? raw.saveVersion : 0;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      // No migration registered; assume forward-compatible and bump.
      current = { ...current, saveVersion: version + 1 };
    } else {
      current = step(current);
    }
    version += 1;
  }
  return current as unknown as GameState;
}
