/**
 * useGameStore — the thin React<->engine bridge (Zustand).
 *
 * The store owns a single Simulation instance (NOT reactive) and drives it with
 * a fixed-step loop. React components read the live GameState and re-render when
 * `version` bumps (after each batch of ticks or command). All game mutations go
 * through the engine via `dispatch` — components never touch state directly.
 *
 * UI-only state (build mode, active dashboard, hovered formula) also lives here
 * but is kept separate from the serializable GameState.
 */

import { create } from 'zustand';
import { Simulation } from '../sim/core/Simulation';
import { createInitialState } from '../sim/data/startingScenario';
import type { GameState } from '../sim/core/GameState';
import type { Command, Speed } from '../sim/core/Commands';
import type { EntityId, FacilityDefId } from '../sim/core/Id';
import { saveGame, loadGame, hasSave } from '../sim/persistence/saveLoad';

const DEFAULT_SEED = 20260601;
const FRAME_MS = 33; // ~30 fps driver

export type DashboardTab =
  | 'none'
  | 'company'
  | 'market'
  | 'supply'
  | 'population'
  | 'debug';

interface GameStore {
  sim: Simulation;
  version: number;
  /** Build mode: when set, clicking the map places this facility. */
  buildDefId: FacilityDefId | null;
  dashboard: DashboardTab;

  // derived getters
  getState: () => GameState;

  // engine control
  dispatch: (command: Command) => void;
  tickOnce: () => void;
  setSpeed: (speed: Speed) => void;
  togglePause: () => void;

  // persistence
  newGame: (seed?: number) => void;
  save: () => void;
  load: () => void;
  hasSave: () => boolean;

  // selection + UI
  select: (id: EntityId | null) => void;
  setBuildDef: (defId: FacilityDefId | null) => void;
  setDashboard: (tab: DashboardTab) => void;

  // internal loop
  _start: () => void;
}

let loopHandle: ReturnType<typeof setInterval> | null = null;

export const useGameStore = create<GameStore>((set, get) => {
  const sim = new Simulation(createInitialState(DEFAULT_SEED));

  function bump(): void {
    set((s) => ({ version: s.version + 1 }));
  }

  return {
    sim,
    version: 0,
    buildDefId: null,
    dashboard: 'none',

    getState: () => get().sim.getState(),

    dispatch: (command) => {
      get().sim.dispatch(command);
      bump();
    },

    tickOnce: () => {
      get().sim.tick();
      bump();
    },

    setSpeed: (speed) => {
      get().sim.dispatch({ type: 'SET_SPEED', speed });
      bump();
    },

    togglePause: () => {
      const s = get().sim.getState();
      get().sim.dispatch({ type: s.paused ? 'RESUME' : 'PAUSE' });
      bump();
    },

    newGame: (seed = DEFAULT_SEED) => {
      get().sim.setState(createInitialState(seed));
      set({ buildDefId: null });
      bump();
    },

    save: () => {
      saveGame(get().sim.getState());
      bump();
    },

    load: () => {
      const loaded = loadGame();
      if (loaded) {
        get().sim.setState(loaded);
        bump();
      }
    },

    hasSave: () => hasSave(),

    select: (id) => {
      get().sim.dispatch({ type: 'SELECT_ENTITY', entityId: id });
      bump();
    },

    setBuildDef: (defId) => set({ buildDefId: defId }),
    setDashboard: (tab) => set({ dashboard: tab }),

    _start: () => {
      if (loopHandle) return;
      loopHandle = setInterval(() => {
        const { sim } = get();
        const state = sim.getState();
        if (state.paused || state.speed === 0) return;
        // speed = ticks per frame.
        const n = state.speed;
        for (let i = 0; i < n; i++) sim.tick();
        bump();
      }, FRAME_MS);
    },
  };
});

// Start the driver loop once (module singleton).
useGameStore.getState()._start();
