import { describe, it, expect } from 'vitest';
import { ticksPerDay, computeTime } from '../core/Tick';
import { Rng } from '../core/Random';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import type { GameState } from '../core/GameState';
import { totalMoneySupply } from '../core/GameState';
import { runAIFounderSystem, founderRoll } from '../systems/AIFounderSystem';
import { FOUNDER_EARLIEST_DAY, FOUNDER_GAP_DAYS } from '../data/constants';
import { serialize, deserialize } from '../persistence/saveLoad';
import { morningBriefing } from '../selectors/advisorSelectors';

/** Drive the founder system directly at day boundaries with citizens pinned
 * prosperous — no other systems run, so the gates are exactly what we set. */
function runFounderDays(state: GameState, days: number, satisfaction = 70): void {
  const tpd = ticksPerDay(state.config);
  for (let i = 0; i < days; i++) {
    state.tick += tpd - (state.tick % tpd || tpd) + tpd;
    for (const c of Object.values(state.citizens)) c.satisfaction = satisfaction;
    runAIFounderSystem({
      state, config: state.config, rng: new Rng(state),
      time: computeTime(state.tick, state.config),
    });
  }
}

const aiCount = (s: GameState) =>
  Object.values(s.firms).filter((f) => f.ownerType === 'ai').length;

describe('AI founders', () => {
  it('tracks market gaps daily and resets them when a seller appears', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    runFounderDays(state, 3);
    expect(state.marketGapDays['bread']).toBe(3);
    expect(state.marketGapDays['tools']).toBe(3);

    const sim = new Simulation(state);
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    runFounderDays(state, 1);
    expect(state.marketGapDays['bread']).toBe(0); // the player serving it resets the gap
    expect(state.marketGapDays['tools']).toBe(4);
  });

  it('nobody founds before the first-mover window closes', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    // Gates all open except the calendar: gaps deep, town pinned prosperous.
    for (const pid of ['bread', 'tools', 'clothes']) state.marketGapDays[pid] = 99;
    runFounderDays(state, FOUNDER_EARLIEST_DAY - 10);
    expect(aiCount(state)).toBe(0);
  });

  it('a persistent gap in a thriving town gets filled — conserved, staffed, announced', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    const supply0 = totalMoneySupply(state);
    for (const pid of ['bread', 'tools', 'clothes']) state.marketGapDays[pid] = FOUNDER_GAP_DAYS;
    runFounderDays(state, FOUNDER_EARLIEST_DAY + 30);
    expect(aiCount(state)).toBeGreaterThan(0);
    expect(totalMoneySupply(state)).toBe(supply0);
    const firm = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    expect(firm.ceoName).toBeTruthy();
    expect(firm.personalityId).toBeTruthy();
    expect(firm.facilities.length).toBe(3); // producer, factory, store
    const store = firm.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'retail')!;
    expect(store.retailProductIds).toEqual(['bread']); // first gap in fixed order
    expect(store.employees.length).toBeGreaterThan(0);
    expect(state.events.some((e) => e.message.includes('📰 New competition'))).toBe(true);
    expect(state.marketGapDays['bread']).toBe(0);
  });

  it('capital does not chase a struggling town', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    for (const pid of ['bread', 'tools', 'clothes']) state.marketGapDays[pid] = 99;
    runFounderDays(state, FOUNDER_EARLIEST_DAY + 30, 50); // below the immigration gate
    expect(aiCount(state)).toBe(0);
  });

  it('the daily roll is deterministic and gap counters survive save/load', () => {
    for (let d = 0; d < 50; d++) expect(founderRoll(11, d)).toBe(founderRoll(11, d));

    const state = createInitialState(11, undefined, 'dust_hollow');
    runFounderDays(state, 5);
    const loaded = deserialize(serialize(state));
    expect(loaded.marketGapDays['bread']).toBe(5);

    // Old saves default the tracker to empty.
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete raw.marketGapDays;
    expect(deserialize(JSON.stringify(raw)).marketGapDays).toEqual({});
  });

  it('the advisor warns about an open staple market, and claiming it clears the warning', () => {
    const state = createInitialState(11, undefined, 'dust_hollow');
    state.marketGapDays['bread'] = 12; // past half the founder clock
    for (const c of Object.values(state.citizens)) c.satisfaction = 70;
    const warning = morningBriefing(state).find((a) => a.icon === '🏗️');
    expect(warning).toBeDefined();
    expect(warning!.text).toContain(`12/${FOUNDER_GAP_DAYS}`);

    // A staffed player store selling bread claims the market — warning gone.
    const player = state.firms[state.playerFirmId]!;
    player.cash = 40000_00;
    const sim = new Simulation(state);
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    expect(morningBriefing(state).some((a) => a.icon === '🏗️')).toBe(false);
  });
});
