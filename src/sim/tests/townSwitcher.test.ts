/**
 * townSwitcher.test.ts — the town switcher, first slice (region.md step 5: the
 * player can LOOK at Port Rosa). This is a VIEW-ONLY control, so the contract is:
 *
 *  - flag OFF ⇒ no switcher renders (a one-town region has no partner to look at)
 *    and the switcher's view-state defaults home — the flag-off UI is unchanged;
 *  - flag ON with a partner ⇒ the switcher lists home + the partner, and a
 *    partner's read-only book (crowd, prices, cover) reads its REAL economy;
 *  - the guard: only the home view may operate — `isHomeView` is the single
 *    predicate the map's build/select callbacks gate on (region.md §3b keeps
 *    player commands home-scoped this slice);
 *  - the switcher's `selectedTownId` is VIEW state, NOT serialized sim state:
 *    switching the view leaves `normalizedSerialize(state)` byte-identical, so
 *    flag-on determinism is untouched by looking at a partner.
 *
 * The DOM-level click-verification of the guard lives in e2e/switchersmoke.mjs
 * (browser); here we pin the store + pure-helper layer those callbacks read.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import type { SimulationConfig } from '../core/SimulationConfig';
import { HOME_TOWN_ID } from '../core/Town';
import { PARTNER_TOWN_ID } from '../data/seedTown';
import { Simulation } from '../core/Simulation';
import { ticksPerDay } from '../core/Tick';
import { normalizedSerialize } from './helpers';
import {
  showSwitcher,
  partnerTownIds,
  isHomeView,
  townLabel,
  townLabels,
  partnerBook,
} from '../../ui/townView';
import { useGameStore } from '../../store/useGameStore';

function regionConfig(): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    servicesEnabled: true,
    realEstateEnabled: true,
    investorsEnabled: true,
    tradeDemandPoolsEnabled: true,
    regionEnabled: true,
  };
}
function cityConfig(): SimulationConfig {
  return { ...regionConfig(), regionEnabled: false };
}

describe('town switcher — flag OFF is a one-town region (no switcher chrome)', () => {
  it('showSwitcher is false and there are no partners in a flag-off City game', () => {
    const s = createInitialState(11, cityConfig());
    expect(showSwitcher(s)).toBe(false);
    expect(partnerTownIds(s)).toEqual([]);
  });

  it('showSwitcher is false in a plain Village too', () => {
    const s = createInitialState(11, DEFAULT_CONFIG);
    expect(showSwitcher(s)).toBe(false);
    expect(partnerTownIds(s)).toEqual([]);
    // Only the home view exists → labels list is just home.
    expect(townLabels(s).map((t) => t.id)).toEqual([HOME_TOWN_ID]);
  });
});

describe('town switcher — flag ON with a partner lists home + the partner', () => {
  it('showSwitcher true; partner is port_rosa', () => {
    const s = createInitialState(11, regionConfig());
    expect(showSwitcher(s)).toBe(true);
    expect(partnerTownIds(s)).toEqual([PARTNER_TOWN_ID]);
    expect(townLabels(s).map((t) => t.id)).toEqual([HOME_TOWN_ID, PARTNER_TOWN_ID]);
  });

  it('home label is the house badge; the partner reuses its trade-city name', () => {
    expect(townLabel(HOME_TOWN_ID).name).toBe('Home');
    expect(townLabel(PARTNER_TOWN_ID).name).toBe('Port Rosa');
  });

  it('the partner book reads its REAL crowd + per-product rows', () => {
    const sim = new Simulation(createInitialState(11, regionConfig()));
    // Run a few days so the partner market has a book to report.
    for (let i = 0; i < ticksPerDay(sim.getState().config) * 5; i++) sim.tick();
    const book = partnerBook(sim.getState(), PARTNER_TOWN_ID);
    expect(book).toBeDefined();
    expect(book!.townId).toBe(PARTNER_TOWN_ID);
    // A cast-less partner still carries a cohort crowd (region.md §4 budget).
    expect(book!.crowd).toBeGreaterThan(0);
    expect(book!.rows.length).toBeGreaterThan(0);
    // Rows are in sorted product-id order (deterministic).
    const ids = book!.rows.map((r) => r.productId);
    expect(ids).toEqual([...ids].sort());
    // Every row names a product; cover is a finite day count or undefined.
    for (const r of book!.rows) {
      expect(r.name.length).toBeGreaterThan(0);
      if (r.coverDays !== undefined) expect(Number.isFinite(r.coverDays)).toBe(true);
    }
  });

  it('partnerBook is undefined for a town that does not exist', () => {
    const s = createInitialState(11, regionConfig());
    expect(partnerBook(s, 'nowhere')).toBeUndefined();
  });
});

describe('town switcher — the operate guard is the home-view predicate', () => {
  it('isHomeView is true only for the home town', () => {
    expect(isHomeView(HOME_TOWN_ID)).toBe(true);
    expect(isHomeView(PARTNER_TOWN_ID)).toBe(false);
  });
});

describe('town switcher — selectedTownId is VIEW state, not serialized sim state', () => {
  beforeEach(() => {
    // Reset the shared store to a clean home-view before each assertion.
    useGameStore.getState().setSelectedTownId(HOME_TOWN_ID);
  });

  it('defaults to the home town', () => {
    expect(useGameStore.getState().selectedTownId).toBe(HOME_TOWN_ID);
  });

  it('setSelectedTownId flips the view', () => {
    useGameStore.getState().setSelectedTownId(PARTNER_TOWN_ID);
    expect(useGameStore.getState().selectedTownId).toBe(PARTNER_TOWN_ID);
  });

  it('newGame resets the view to home', () => {
    useGameStore.getState().setSelectedTownId(PARTNER_TOWN_ID);
    useGameStore.getState().newGame(11, 'standard', 'meadowbrook', false, 'cozy', 'village');
    expect(useGameStore.getState().selectedTownId).toBe(HOME_TOWN_ID);
  });

  it('switching the view leaves normalizedSerialize byte-identical (determinism unaffected)', () => {
    const store = useGameStore.getState();
    const before = normalizedSerialize(store.getState());
    store.setSelectedTownId(PARTNER_TOWN_ID);
    const after = normalizedSerialize(store.getState());
    expect(after).toBe(before);
    // And the sim state carries no selectedTownId field at all — it is store-only.
    expect('selectedTownId' in (store.getState() as unknown as Record<string, unknown>)).toBe(false);
  });
});
