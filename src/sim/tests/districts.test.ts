import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply, recordTransaction } from '../core/GameState';
import { cohortAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { districtAt } from '../entities/District';
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
    state.cohorts[id] = emptyCohort('the_rows', 'worker');
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
