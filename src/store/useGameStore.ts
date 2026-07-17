/**
 * useGameStore — the thin React<->engine bridge (Zustand).
 *
 * Owns a single Simulation instance (NOT reactive) and drives it with a
 * real-time, fixed-step accumulator loop on requestAnimationFrame:
 *
 *   speed (1/5/20/100) -> a target ticks-per-second. Each animation frame we
 *   accumulate elapsed real time and run the right number of ticks. This makes
 *   playback smooth and watchable (citizens/trucks glide) instead of being tied
 *   to frame rate.
 *
 * React components re-render off a throttled `version` bump (a few times/sec);
 * the canvas town renderer reads live state every frame on its own loop, so the
 * map is always smooth regardless of React.
 *
 * The world is persistent: it auto-saves to localStorage periodically and on
 * unload, and auto-restores on boot.
 */

import { create } from 'zustand';
import { Simulation } from '../sim/core/Simulation';
import { createInitialState } from '../sim/data/startingScenario';
import type { GameState } from '../sim/core/GameState';
import type { Command, Speed } from '../sim/core/Commands';
import type { EntityId, FacilityDefId } from '../sim/core/Id';
import { saveGame, loadGame, hasSave } from '../sim/persistence/saveLoad';

const DEFAULT_SEED = 20260601;

/** Speed multiplier -> simulation ticks per real second. */
const SPEED_TPS: Record<Speed, number> = { 0: 0, 1: 4, 5: 18, 20: 70, 100: 280 };
/** Don't let a tab that was backgrounded spiral; cap catch-up per frame. */
const MAX_TICKS_PER_FRAME = 360;
/** How often to notify React (ms). The canvas updates independently at 60fps. */
const REACT_REFRESH_MS = 140;
const AUTOSAVE_MS = 4000;

export type DashboardTab =
  | 'none'
  | 'company'
  | 'market'
  | 'supply'
  | 'population'
  | 'awards'
  | 'debug';

interface GameStore {
  sim: Simulation;
  version: number;
  buildDefId: FacilityDefId | null;
  dashboard: DashboardTab;
  showIntro: boolean;
  setShowIntro: (v: boolean) => void;
  /** Wall-clock ms at the last tick, exposed for render interpolation. */
  lastTickAt: number;
  tickIntervalMs: number;

  getState: () => GameState;
  dispatch: (command: Command) => void;
  tickOnce: () => void;
  setSpeed: (speed: Speed) => void;
  togglePause: () => void;

  newGame: (seed?: number) => void;
  save: () => void;
  load: () => void;
  hasSave: () => boolean;

  select: (id: EntityId | null) => void;
  setBuildDef: (defId: FacilityDefId | null) => void;
  setDashboard: (tab: DashboardTab) => void;

  _start: () => void;
}

function initialState(): GameState {
  const loaded = loadGame();
  if (loaded) return loaded;
  return createInitialState(DEFAULT_SEED);
}

export const useGameStore = create<GameStore>((set, get) => {
  const sim = new Simulation(initialState());

  let lastReactBump = 0;
  function bump(force = false): void {
    const now = performance.now();
    if (force || now - lastReactBump >= REACT_REFRESH_MS) {
      lastReactBump = now;
      set((s) => ({ version: s.version + 1 }));
    }
  }

  return {
    sim,
    version: 0,
    buildDefId: null,
    dashboard: 'none',
    showIntro: (() => {
      try { return localStorage.getItem('econsim.introSeen') !== '1'; } catch { return true; }
    })(),
    setShowIntro: (v) => {
      if (!v) { try { localStorage.setItem('econsim.introSeen', '1'); } catch { /* ignore */ } }
      set({ showIntro: v });
    },
    lastTickAt: performance.now(),
    tickIntervalMs: 1000 / SPEED_TPS[1],

    getState: () => get().sim.getState(),

    dispatch: (command) => {
      get().sim.dispatch(command);
      bump(true);
    },

    tickOnce: () => {
      get().sim.tick();
      set({ lastTickAt: performance.now() });
      bump(true);
    },

    setSpeed: (speed) => {
      get().sim.dispatch({ type: 'SET_SPEED', speed });
      set({ tickIntervalMs: speed ? 1000 / SPEED_TPS[speed] : 0 });
      bump(true);
    },

    togglePause: () => {
      const s = get().sim.getState();
      get().sim.dispatch({ type: s.paused ? 'RESUME' : 'PAUSE' });
      bump(true);
    },

    newGame: (seed = Math.floor(Math.random() * 1_000_000)) => {
      get().sim.setState(createInitialState(seed));
      set({ buildDefId: null });
      bump(true);
    },

    save: () => {
      saveGame(get().sim.getState());
      bump(true);
    },

    load: () => {
      const loaded = loadGame();
      if (loaded) {
        get().sim.setState(loaded);
        bump(true);
      }
    },

    hasSave: () => hasSave(),

    select: (id) => {
      get().sim.dispatch({ type: 'SELECT_ENTITY', entityId: id });
      bump(true);
    },

    setBuildDef: (defId) => set({ buildDefId: defId }),
    setDashboard: (tab) => set({ dashboard: tab }),

    _start: () => {
      if (typeof window === 'undefined') return;
      let last = performance.now();
      let acc = 0;
      let lastAutosave = performance.now();

      const frame = (now: number): void => {
        const dt = Math.min(250, now - last); // clamp big gaps (tab switches)
        last = now;
        const state = get().sim.getState();
        const tps = state.paused ? 0 : SPEED_TPS[state.speed];

        if (tps > 0) {
          acc += (dt / 1000) * tps;
          let steps = Math.floor(acc);
          acc -= steps;
          if (steps > MAX_TICKS_PER_FRAME) steps = MAX_TICKS_PER_FRAME;
          if (steps > 0) {
            const sim = get().sim;
            for (let i = 0; i < steps; i++) sim.tick();
            set({ lastTickAt: now });
            bump();
          }
        }

        if (now - lastAutosave >= AUTOSAVE_MS) {
          lastAutosave = now;
          saveGame(get().sim.getState());
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);

      window.addEventListener('beforeunload', () => saveGame(get().sim.getState()));
    },
  };
});

useGameStore.getState()._start();
