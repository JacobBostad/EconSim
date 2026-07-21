import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply, recordTransaction } from '../core/GameState';
import { cohortAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { districtAt, shoppingDistrictIds } from '../entities/District';
import { distance } from '../entities/Location';
import { emptyCohort, cohortId } from '../entities/Cohort';
import { serialize, deserialize } from '../persistence/saveLoad';

describe('Districts + dark cohorts (world-scale A2)', () => {
  it('the district partition covers every facility and citizen exactly once', () => {
    const state = newSim(11).getState();
    expect(Object.keys(state.districts).sort()).toEqual(['ironrow', 'midmarket', 'the_rows']);
    for (const fac of Object.values(state.facilities)) {
      expect(districtAt(state.districts, fac.location.x, fac.location.y)).toBeTruthy();
    }
    for (const cit of Object.values(state.citizens)) {
      expect(districtAt(state.districts, cit.currentLocation.x, cit.currentLocation.y)).toBeTruthy();
    }
    // Off-map points never strand: they land in the residential district.
    expect(districtAt(state.districts, 9999, 9999)?.kind).toBe('residential');
  });

  it('district desirability updates daily, deterministically, and dark', () => {
    const a = newSim(11);
    const b = newSim(11);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 5);
    b.run(tpd * 5);
    const da = a.getState().districts;
    const db = b.getState().districts;
    for (const id of Object.keys(da)) {
      expect(da[id]!.desirability).toBe(db[id]!.desirability);
      expect(da[id]!.desirability).toBeGreaterThanOrEqual(0);
      expect(da[id]!.desirability).toBeLessThanOrEqual(1);
    }
    // Residential holds the homes: it should read most desirable by weight.
    expect(da['the_rows']!.desirability).toBeGreaterThan(0);
  });

  it('cohorts are real money-holding accounts — conserved through every flow', () => {
    const state = newSim(11).getState();
    const supply0 = totalMoneySupply(state);
    const id = cohortId('the_rows', 'worker');
    state.cohorts[id] = emptyCohort('the_rows', 'worker', 'city');
    expect(totalMoneySupply(state)).toBe(supply0); // empty pool adds nothing

    recordTransaction(state, {
      from: WORLD_ACCOUNT, to: cohortAccount(id), amount: 5000_00,
      firmId: null, category: 'none', note: 'crowd arrives with savings',
    });
    expect(state.cohorts[id]!.cashPool).toBe(5000_00);
    expect(totalMoneySupply(state)).toBe(supply0);

    const player = state.firms[state.playerFirmId]!;
    const firmCash0 = player.cash;
    recordTransaction(state, {
      from: cohortAccount(id), to: { kind: 'firm', id: player.id }, amount: 1200_00,
      firmId: player.id, category: 'revenue', note: 'crowd spending',
    });
    expect(state.cohorts[id]!.cashPool).toBe(3800_00);
    expect(player.cash).toBe(firmCash0 + 1200_00);
    expect(player.accounting.today.revenue).toBeGreaterThanOrEqual(1200_00);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('village towns stay dark: no cohorts, preset defaults, saves round-trip', () => {
    const sim = newSim(11);
    const state = sim.getState();
    expect(state.config.sizePreset).toBe('village');
    expect(Object.keys(state.cohorts)).toHaveLength(0);
    sim.run(ticksPerDay(state.config) * 3);
    expect(Object.keys(state.cohorts)).toHaveLength(0); // nothing populates them

    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
    // Old saves that predate districts get the default partition + preset.
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete raw.districts;
    delete raw.cohorts;
    delete (raw.config as Record<string, unknown>).sizePreset;
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.config.sizePreset).toBe('village');
    expect(Object.keys(loaded.districts).sort()).toEqual(['ironrow', 'midmarket', 'the_rows']);
    expect(loaded.cohorts).toEqual({});
  });
});

/**
 * A4 physical districts — map presets, authored partitions that tile exactly,
 * and the placement rewrite (district slot enumeration). Village-preset A4
 * behaviour is covered above and by the bit-identity baseline; these guard the
 * NEW City/Metropolis geometry.
 */
describe('Districts A4 — map presets + partition invariants', () => {
  /** Every partition must TILE its map: bounds pairwise-disjoint, inside the map,
   * and summing to exactly the map area (⟹ exact cover for axis-aligned rects). */
  function assertTiles(districts: Record<string, { bounds: { x: number; y: number; w: number; h: number } }>, w: number, h: number): void {
    const ds = Object.values(districts);
    let area = 0;
    for (const d of ds) {
      const b = d.bounds;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(w);
      expect(b.y + b.h).toBeLessThanOrEqual(h);
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
      area += b.w * b.h;
    }
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const a = ds[i]!.bounds;
        const c = ds[j]!.bounds;
        const overlap =
          a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    expect(area).toBe(w * h); // exact partition — no gap, no overlap
  }

  it('the size presets carry their authored map dimensions into config', () => {
    expect(createInitialState(1).config).toMatchObject({ mapWidth: 130, mapHeight: 92 });
    const city = createInitialState(1, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    expect(city.config.mapWidth).toBe(SIZE_PRESETS.city.mapWidth);
    expect(city.config.mapHeight).toBe(SIZE_PRESETS.city.mapHeight);
    const metro = createInitialState(1, { ...DEFAULT_CONFIG, sizePreset: 'metropolis' });
    expect(metro.config.mapWidth).toBe(SIZE_PRESETS.metropolis.mapWidth);
    expect(metro.config.mapHeight).toBe(SIZE_PRESETS.metropolis.mapHeight);
  });

  it('the Village partition is unchanged (the inner-city ids persist across presets)', () => {
    const v = createInitialState(1).districts;
    expect(Object.keys(v).sort()).toEqual(['ironrow', 'midmarket', 'the_rows']);
    assertTiles(v, 130, 92);
  });

  it('the City partition tiles 260×184 exactly, with the inner-city ids kept', () => {
    const s = createInitialState(1, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const d = s.districts;
    assertTiles(d, s.config.mapWidth, s.config.mapHeight);
    // More districts than the Village three; the inner-city ids persist.
    expect(Object.keys(d).length).toBeGreaterThan(3);
    for (const id of ['ironrow', 'midmarket', 'the_rows']) expect(d[id]).toBeTruthy();
    // Two residential districts, one commercial core, one industrial belt, civic.
    const byKind = (k: string) => Object.values(d).filter((x) => x.kind === k).length;
    expect(byKind('residential')).toBe(2);
    expect(byKind('commercial')).toBeGreaterThanOrEqual(1);
    expect(byKind('industrial')).toBeGreaterThanOrEqual(1);
    expect(byKind('civic')).toBeGreaterThanOrEqual(1);
    // Every starting facility and citizen still lands in exactly one district.
    for (const fac of Object.values(s.facilities)) {
      expect(districtAt(d, fac.location.x, fac.location.y)).toBeTruthy();
    }
    for (const cit of Object.values(s.citizens)) {
      expect(districtAt(d, cit.currentLocation.x, cit.currentLocation.y)).toBeTruthy();
    }
    expect(districtAt(d, 99999, 99999)?.kind).toBe('residential'); // off-map never strands
  });

  it('the Metropolis partition tiles 390×276 exactly', () => {
    const s = createInitialState(1, { ...DEFAULT_CONFIG, sizePreset: 'metropolis' });
    assertTiles(s.districts, s.config.mapWidth, s.config.mapHeight);
    expect(Object.keys(s.districts).length).toBeGreaterThan(3);
    expect(Object.values(s.districts).filter((x) => x.kind === 'residential').length).toBe(3);
  });

  /**
   * Residential reach guard (batch-7 minor): every residential quarter must be
   * able to reach a staple-capable COMMERCIAL district through
   * `shoppingDistrictIds` (its own id + `adjacent`) AND be geometrically close
   * enough that a home anywhere in the quarter can walk to a store within
   * `maxShoppingDistance` — the same reach the runtime `districts.test.ts` city
   * soak asserts on placed stores. This is a PURE-DATA guard: the runtime reach
   * check can only exercise the bootstrap district (`the_rows`, where the crowd
   * seeds and immigration fills first — homes never spill into `the_yards` /
   * `westgate` within a soak), so a layout edit that stranded an outer quarter
   * (dropping `midmarket` from its `adjacent`, or pushing the residential band
   * north until the commercial core falls out of walking range) would slip past
   * every runtime test. On the shipped Metropolis, `westgate`'s worst home corner
   * sits 89 units from `midmarket` against a 95 budget — 6 units of margin — so
   * this guard is what keeps that margin from silently going negative.
   */
  describe('residential reach guard — every quarter reaches a staple-capable commercial', () => {
    /** Distance from a point to the nearest point of an axis-aligned rect (0 if
     * inside). The point of a residential rect farthest from a commercial rect is
     * always one of its four corners, so the worst-case home is a corner. */
    const distToRect = (px: number, py: number, b: { x: number; y: number; w: number; h: number }): number => {
      const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
      const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
      return Math.hypot(dx, dy);
    };

    for (const preset of ['village', 'city', 'metropolis'] as const) {
      it(`${preset}: every residential district reaches a commercial within maxShoppingDistance`, () => {
        const s = createInitialState(1, { ...DEFAULT_CONFIG, sizePreset: preset });
        const { districts } = s;
        const max = s.config.maxShoppingDistance;
        const residential = Object.values(districts).filter((d) => d.kind === 'residential');
        expect(residential.length).toBeGreaterThan(0);

        for (const r of residential) {
          const b = r.bounds;
          const corners: [number, number][] = [
            [b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h],
          ];
          // Commercial districts inside r's own+adjacent shopping set (the hard
          // gate district-local shopping applies before any distance score).
          const reachableCommercial = [...shoppingDistrictIds(districts, r.id)]
            .map((id) => districts[id]!)
            .filter((d) => d.kind === 'commercial');
          expect(
            reachableCommercial.length,
            `${preset}/${r.id} has no commercial district in its own+adjacent set`,
          ).toBeGreaterThanOrEqual(1);

          // At least one of them must be close enough that even the residential
          // quarter's farthest corner is within a shop-window walk of it.
          const worstCornerToNearest = Math.min(
            ...reachableCommercial.map((c) => Math.max(...corners.map(([px, py]) => distToRect(px, py, c.bounds)))),
          );
          expect(
            worstCornerToNearest,
            `${preset}/${r.id} strands its far corner ${worstCornerToNearest.toFixed(1)} units from any reachable commercial (max ${max})`,
          ).toBeLessThanOrEqual(max);
        }
      });
    }
  });
});

/**
 * A4 placement rewrite + district-local shopping — the acceptance the design
 * doc's Phase A4 pins: found many chains on the big map without a silent
 * placement abort (facilities grow well past the old ~15-chain saturation), and
 * every home can reach a staple store within the shopper's district + adjacent.
 */
describe('Districts A4 — placement + reach on the City map', () => {
  it('founds many chains without silent placement abort, and every home reaches a staple', () => {
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const storeCount = () =>
      Object.values(state.facilities).filter((f) => f.retailProductIds.length > 0).length;
    const startingStores = storeCount();
    sim.run(ticksPerDay(state.config) * 220);

    // The under-supply founder path keeps building on the big map: the store
    // count grows past the old three-fixed-rows ~15-chain saturation, and no
    // build is silently abandoned for want of ground (the map has slots to spare).
    const stores = storeCount();
    expect(stores).toBeGreaterThan(startingStores + 3);
    const aiFirms = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
    expect(aiFirms).toBeGreaterThanOrEqual(SIZE_PRESETS.city.founderMaxAiFirms > 6 ? 5 : 3);

    // Reach: every home has a bread store within maxShoppingDistance in its own
    // district + adjacent quarters — the district-local shopping contract. (Bread
    // is the staple every founder answers, so a served town always stocks it.)
    let homes = 0;
    let reached = 0;
    for (const f of Object.values(state.facilities)) {
      if (f.type !== 'home') continue;
      homes += 1;
      const hd = districtAt(state.districts, f.location.x, f.location.y);
      if (!hd) continue;
      const allowed = shoppingDistrictIds(state.districts, hd.id);
      for (const g of Object.values(state.facilities)) {
        if (!g.retailProductIds.includes('bread')) continue;
        if (g.status === 'closed') continue;
        const gd = districtAt(state.districts, g.location.x, g.location.y);
        if (!gd || !allowed.has(gd.id)) continue;
        if (distance(f.location, g.location) <= state.config.maxShoppingDistance) {
          reached += 1;
          break;
        }
      }
    }
    expect(homes).toBeGreaterThan(0);
    // Every home is in reach of a staple — the whole point of the physical
    // partition (a store on the far side of the map is not a store you can shop).
    expect(reached).toBe(homes);
  });
});
