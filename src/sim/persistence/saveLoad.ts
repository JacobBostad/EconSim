/**
 * saveLoad.ts — serialize/deserialize GameState and persist to localStorage.
 *
 * GameState is a plain JSON-safe object graph, so serialization is just
 * JSON.stringify. Loading runs any registered migrations so old saves keep
 * working. The pure serialize/deserialize functions are also used by tests.
 */

import type { GameState } from '../core/GameState';
import { migrate } from './migrations';

const PREFIX = 'econsim.save.';
const DEFAULT_SLOT = 'default';
/** Where the outgoing town is stashed when a new game starts. */
export const BACKUP_SLOT = 'backup';

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return migrate(raw);
}

/** Deep structural clone of a state via serialize round-trip. */
export function cloneState(state: GameState): GameState {
  return deserialize(serialize(state));
}

function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function saveGame(state: GameState, slot: string = DEFAULT_SLOT): boolean {
  if (!hasStorage()) return false;
  try {
    localStorage.setItem(PREFIX + slot, serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(slot: string = DEFAULT_SLOT): GameState | null {
  if (!hasStorage()) return null;
  try {
    const json = localStorage.getItem(PREFIX + slot);
    if (!json) return null;
    return deserialize(json);
  } catch {
    return null;
  }
}

export function hasSave(slot: string = DEFAULT_SLOT): boolean {
  if (!hasStorage()) return false;
  return localStorage.getItem(PREFIX + slot) != null;
}

export function listSaves(): string[] {
  if (!hasStorage()) return [];
  const slots: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PREFIX)) slots.push(key.slice(PREFIX.length));
  }
  return slots;
}
