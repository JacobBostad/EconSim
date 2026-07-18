import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { ticksPerDay } from '../core/Tick';
import { PERSONALITIES, getPersonality, NEUTRAL, ceoQuote } from '../data/personalities';
import { makeContext } from '../core/GameState';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { addStock } from '../entities/Inventory';
import { getProduct } from '../data/products';

function sunrise(state: ReturnType<Simulation['getState']>) {
  return Object.values(state.firms).find((f) => f.name === 'Sunrise Foods')!;
}

describe('AI personalities', () => {
  it('every AI firm gets a CEO and personality at creation; the player gets none', () => {
    const state = createInitialState(1);
    for (const firm of Object.values(state.firms)) {
      if (firm.ownerType === 'ai') {
        expect(firm.personalityId).toBeTruthy();
        expect(firm.ceoName).toBeTruthy();
        expect(PERSONALITIES[firm.personalityId as keyof typeof PERSONALITIES]).toBeTruthy();
      } else {
        expect(firm.personalityId).toBeNull();
      }
    }
    // Scenario pins: Sunrise builds brand, Granite fights on price.
    expect(sunrise(state).personalityId).toBe('brand_builder');
    expect(
      Object.values(state.firms).find((f) => f.name === 'Granite Industries')!.personalityId,
    ).toBe('price_fighter');
    expect(getPersonality(null)).toBe(NEUTRAL);
  });

  it('a brand builder ramps ads faster than a price fighter in a contested market', () => {
    const run = (personality: 'brand_builder' | 'price_fighter') => {
      const state = createInitialState(9);
      const firm = sunrise(state);
      firm.personalityId = personality;
      firm.marketShareByProduct['bread'] = 0.3; // contested, not dominant
      firm.cash = 30000_00;
      firm.adBudgetByProduct['bread'] = 10_00;
      state.tick = ticksPerDay(state.config); // day boundary
      runAIStrategySystem(makeContext(state));
      return firm.adBudgetByProduct['bread']!;
    };
    expect(run('brand_builder')).toBeGreaterThan(run('price_fighter'));
  });

  it('an exporter ships surplus a brand builder would keep at home', () => {
    // A producing facility with free (uncontracted) surplus: the exporter's
    // lower keep ships it; the brand builder holds more back.
    const run = (personality: 'exporter' | 'brand_builder') => {
      const state = createInitialState(9);
      const granite = Object.values(state.firms).find((f) => f.name === 'Granite Industries')!;
      granite.personalityId = personality;
      const mine = granite.facilities.map((id) => state.firms && state.facilities[id]!).find((f) => f.type === 'mine')!;
      // Sever outbound contracts so nothing is reserved for home shelves.
      for (const cid of Object.keys(state.contracts)) {
        if (state.contracts[cid]!.sourceFacilityId === mine.id) delete state.contracts[cid];
      }
      mine.outputInventory = {};
      addStock(mine.outputInventory, 'minerals', 26, 60);
      state.tradeCity.pricesByProduct['minerals'] = Math.round(getProduct('minerals').basePrice * 1.3);
      state.tick = ticksPerDay(state.config);
      runAIStrategySystem(makeContext(state));
      return granite.exportRevenue;
    };
    // keep: exporter 10 vs neutral-ish 20 → exporter ships 16, builder ships 6.
    expect(run('exporter')).toBeGreaterThan(run('brand_builder'));
  });
});

describe('CEO quotes', () => {
  it('attaches a deterministic CEO quote to a max-ad-campaign headline', () => {
    const state = createInitialState(9);
    const firm = sunrise(state);
    firm.marketShareByProduct['bread'] = 0.3;
    firm.cash = 30000_00;
    firm.adBudgetByProduct['bread'] = 56_00; // one step below the 1.5x cap
    state.tick = ticksPerDay(state.config);
    runAIStrategySystem(makeContext(state));
    const ev = state.events.find((e) => e.message.includes('maximum ad campaign'));
    expect(ev).toBeTruthy();
    expect(ev!.message).toContain(firm.ceoName!);
    expect(ev!.message).toContain('—');
  });

  it('never quotes a firm without a CEO (the player)', () => {
    const state = createInitialState(9);
    const player = state.firms[state.playerFirmId]!;
    const rng = { pick: <T,>(arr: T[]): T | undefined => arr[0] };
    expect(ceoQuote(rng, player, 'ads')).toBe('');
  });
});
