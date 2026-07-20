import React from 'react';
import { useGameStore } from '../store/useGameStore';
import {
  populationStats,
  allCitizens,
  citizenActionLabel,
  laborMarketStats,
  employerBreakdown,
  spendingPower,
} from '../sim/selectors/citizenSelectors';
import { macroIndicators } from '../sim/selectors/debugSelectors';
import { formatMoney } from '../utils/formatMoney';
import { FormulaTooltip } from './FormulaTooltip';
import { TrendCard } from './Sparkline';
import { cyclePhase } from '../sim/systems/TownStatsSystem';
import { satisfactionAnatomy } from '../sim/selectors/satisfactionSelectors';
import { districtAt, type DistrictKind } from '../sim/entities/District';

const DISTRICT_KIND_ICONS: Record<DistrictKind, string> = {
  industrial: '🏭',
  commercial: '🛍️',
  residential: '🏘️',
  civic: '🏛️',
  mixed: '🌆',
};

export function PopulationDashboard(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const select = useGameStore((s) => s.select);
  const state = sim.getState();
  const pop = populationStats(state);
  const macro = macroIndicators(state);
  const citizens = allCitizens(state);
  const labor = laborMarketStats(state);
  const employers = employerBreakdown(state);
  const spend = spendingPower(state);
  const history = state.townHistory;
  const phase = cyclePhase(history);
  const anatomy = satisfactionAnatomy(state);
  const maxBucket = Math.max(1, ...labor.skillBuckets.map((b) => b.count));
  const districts = Object.values(state.districts).sort((a, b) => a.id.localeCompare(b.id));
  const crowdByDistrict: Record<string, number> = {};
  for (const id in state.cohorts) {
    const co = state.cohorts[id]!;
    crowdByDistrict[co.districtId] = (crowdByDistrict[co.districtId] ?? 0) + co.population;
  }
  const buildingsByDistrict: Record<string, number> = {};
  for (const id in state.facilities) {
    const loc = state.facilities[id]!.location;
    const d = districtAt(state.districts, loc.x, loc.y);
    if (d) buildingsByDistrict[d.id] = (buildingsByDistrict[d.id] ?? 0) + 1;
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Economy Indicators</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Stat label="Price index" value={`${macro.priceIndex.toFixed(0)}`} hint="Average market price ÷ base price across consumer goods, ×100. 100 = at base; >100 = inflation." />
        <Stat label="Consumer spend (today)" value={formatMoney(macro.consumerSpendToday)} />
        <Stat label="Goods sold (today)" value={String(macro.unitsSoldToday)} />
        <Stat label="Unmet demand (today)" value={String(macro.unmetDemandToday)} />
        <Stat label="Goods in economy" value={String(macro.goodsInventory)} />
        <Stat label="Active firms" value={String(macro.activeFirms)} />
      </div>

      <h3>Population</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Stat label="Population" value={String(pop.total)} />
        <Stat label="Employed" value={`${pop.employed} (${(pop.employmentRate * 100).toFixed(0)}%)`} />
        <Stat label="Unemployed" value={String(pop.unemployed)} />
        <Stat label="Avg wage/day" value={formatMoney(pop.averageWage)} />
        <Stat label="Avg cash" value={formatMoney(pop.averageCash)} />
        <Stat label="Avg satisfaction" value={`${pop.averageSatisfaction.toFixed(0)}/100`} />
        <Stat label="Unmet needs today" value={String(pop.totalUnmetNeedsToday)} />
      </div>

      <h3>
        Town Trends{' '}
        {state.emigrationPressure > 0 ? (
          <span className="tag red" style={{ verticalAlign: 'middle' }}>
            🧳 Families near leaving — day {state.emigrationPressure} of misery
          </span>
        ) : phase !== 'steady' && (
          <span className={`tag ${phase === 'boom' ? 'green' : 'amber'}`} style={{ verticalAlign: 'middle' }}>
            {phase === 'boom' ? '📈 Hiring boom' : '🚶 Absorbing arrivals'}
          </span>
        )}
      </h3>
      {history.length >= 2 ? (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <TrendCard
            label="Population (60d)"
            latest={String(history[history.length - 1]!.population)}
            points={history.slice(-60).map((h) => h.population)}
          />
          <TrendCard
            label="Employment rate (60d)"
            latest={`${Math.round((history[history.length - 1]!.employed / Math.max(1, history[history.length - 1]!.population)) * 100)}%`}
            points={history.slice(-60).map((h) => h.employed / Math.max(1, h.population))}
            color="var(--accent)"
          />
          <TrendCard
            label="Satisfaction (60d)"
            latest={history[history.length - 1]!.avgSatisfaction.toFixed(0)}
            points={history.slice(-60).map((h) => h.avgSatisfaction)}
            color="var(--green)"
          />
        </div>
      ) : (
        <p className="muted small">Trends appear after the first full day.</p>
      )}
      {state.emigrationDepartures > 0 && (
        <p className="muted small" style={{ marginTop: 4 }}>
          🧳 {state.emigrationDepartures} {state.emigrationDepartures === 1 ? 'family has' : 'families have'} left
          town for good — misery past day 10 starts the wagons rolling; one good day stops them.
        </p>
      )}

      <h3>Districts</h3>
      {districts.length === 0 ? (
        <p className="muted small">No districts yet.</p>
      ) : (
        <div className="card" style={{ minWidth: 280, marginBottom: 0 }}>
          {districts.map((d) => {
            const crowd = crowdByDistrict[d.id] ?? 0;
            const buildings = buildingsByDistrict[d.id] ?? 0;
            return (
              <div className="row small" key={d.id} style={{ gap: 6 }}>
                <span style={{ width: 130 }}>{DISTRICT_KIND_ICONS[d.kind]} {d.name}</span>
                <span className="muted" style={{ width: 78 }}>{d.kind}</span>
                <span className="bar" style={{ flex: 1 }}>
                  <span style={{ width: `${Math.round(d.desirability * 100)}%` }} />
                </span>
                <span className="mono" style={{ width: 36, textAlign: 'right' }}>
                  {Math.round(d.desirability * 100)}%
                </span>
                <span className="mono" style={{ width: 56, textAlign: 'right' }} title="Crowd population (cohorts)">
                  {crowd > 0 ? crowd : '—'}
                </span>
                <span className="muted" style={{ width: 80, textAlign: 'right' }}>
                  {buildings} building{buildings === 1 ? '' : 's'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <h3>Satisfaction Anatomy</h3>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="card" style={{ minWidth: 250, marginBottom: 0 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>
            <FormulaTooltip title="Equilibrium target" explanation="Citizens drift toward 50 + employment (+20 employed / −5 not) + housing (+5 apartments) + provisioning (+15 fully provided, eroded by unmet needs, floor −30). Immigration needs ≥55.">
              Equilibrium target
            </FormulaTooltip>
            <span className="mono"> {anatomy.equilibrium.toFixed(0)}</span>
            <span className="muted"> (now {anatomy.average.toFixed(0)})</span>
          </div>
          <div className="kv small"><span className="k">Base</span><span className="mono">+{anatomy.base}</span></div>
          <div className="kv small"><span className="k">Employment</span>
            <span className="mono" style={{ color: anatomy.employmentTerm >= 15 ? 'var(--green)' : 'var(--amber)' }}>
              {anatomy.employmentTerm >= 0 ? '+' : ''}{anatomy.employmentTerm.toFixed(1)}
            </span></div>
          <div className="kv small"><span className="k">Housing</span>
            <span className="mono">{anatomy.housingTerm >= 0 ? '+' : ''}{anatomy.housingTerm.toFixed(1)}</span></div>
          <div className="kv small"><span className="k">Provisioning</span>
            <span className="mono" style={{ color: anatomy.provisioningTerm >= 8 ? 'var(--green)' : 'var(--red)' }}>
              {anatomy.provisioningTerm >= 0 ? '+' : ''}{anatomy.provisioningTerm.toFixed(1)}
            </span></div>
        </div>
        <div className="card" style={{ minWidth: 250, marginBottom: 0 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>What shortages cost (points)</div>
          {anatomy.productDrag.length === 0 && (
            <div className="small" style={{ color: 'var(--green)' }}>✓ No product is dragging the town down.</div>
          )}
          {anatomy.productDrag.slice(0, 5).map((d) => (
            <div className="row small" key={d.productId} style={{ gap: 6 }}>
              <span style={{ width: 70 }}>{d.name}</span>
              <span className="bar" style={{ flex: 1 }}>
                <span style={{ width: `${Math.min(100, (d.points / Math.max(0.1, anatomy.productDrag[0]!.points)) * 100)}%` }} />
              </span>
              <span className="mono" style={{ width: 44, textAlign: 'right' }}>−{d.points.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>

      <h3>Prosperity Ladder</h3>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="card" style={{ minWidth: 280, marginBottom: 0 }}>
          {(() => {
            const tiers = [
              { id: 'worker' as const, label: '🔧 Workers', color: 'var(--amber)', hint: 'Getting by — staples and tools.' },
              { id: 'comfortable' as const, label: '🏠 Comfortable', color: 'var(--accent)', hint: 'A decent life: satisfied, with good wages ($18+/day) or savings ($250+).' },
              { id: 'affluent' as const, label: '🥂 Affluent', color: 'var(--green)', hint: 'Prospering: happy, well-paid ($26+/day) or wealthy, well-housed or saving.' },
            ];
            const counts = { worker: 0, comfortable: 0, affluent: 0 };
            let climbing = 0;
            for (const c of citizens) {
              counts[c.tier] += 1;
              if (c.tierStreak > 0) climbing += 1;
            }
            const total = Math.max(1, citizens.length);
            return (
              <>
                <div className="muted small" style={{ marginBottom: 4 }}>
                  <FormulaTooltip title="Prosperity tiers" explanation="Citizens climb when steady income (good wages or a savings cushion), satisfaction, and — for affluent — good housing or wealth hold for days in a row, and slide back when their tier's floor gives way. Later: each tier shops differently.">
                    Who's climbing the ladder
                  </FormulaTooltip>
                </div>
                {tiers.map((t) => (
                  <div className="row small" key={t.id} style={{ gap: 6 }} title={t.hint}>
                    <span style={{ width: 110 }}>{t.label}</span>
                    <span className="bar" style={{ flex: 1 }}>
                      <span style={{ width: `${(counts[t.id] / total) * 100}%`, background: t.color }} />
                    </span>
                    <span className="mono" style={{ width: 70, textAlign: 'right' }}>
                      {counts[t.id]} ({Math.round((counts[t.id] / total) * 100)}%)
                    </span>
                  </div>
                ))}
                <div className="muted small" style={{ marginTop: 4 }}>
                  {climbing > 0
                    ? `${climbing} citizen${climbing === 1 ? ' is' : 's are'} on a streak toward the next tier.`
                    : 'Nobody is currently on a promotion streak — raise wages and keep shelves full.'}
                </div>
              </>
            );
          })()}
        </div>
        {history.length >= 2 && (
          <>
            <TrendCard
              label="Middle class share (60d)"
              latest={`${Math.round(
                ((history[history.length - 1]!.comfortable + history[history.length - 1]!.affluent) /
                  Math.max(1, history[history.length - 1]!.population)) * 100,
              )}%`}
              points={history.slice(-60).map(
                (h) => (h.comfortable + h.affluent) / Math.max(1, h.population),
              )}
              color="var(--accent)"
            />
            <TrendCard
              label="Affluent citizens (60d)"
              latest={String(history[history.length - 1]!.affluent)}
              points={history.slice(-60).map((h) => h.affluent)}
              color="var(--green)"
            />
          </>
        )}
      </div>

      <h3>Spending Power</h3>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="card" style={{ minWidth: 240, marginBottom: 0 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>Household money (today)</div>
          <div className="kv small"><span className="k">Wages earned</span><span className="mono">{formatMoney(spend.wagesEarnedToday)}</span></div>
          <div className="kv small"><span className="k">Spent in stores</span><span className="mono">{formatMoney(spend.spentToday)}</span></div>
          <div className="kv small"><span className="k">Purchases</span><span className="mono">{spend.purchasesToday}</span></div>
          <div className="kv small"><span className="k">Avg cash held</span><span className="mono">{formatMoney(spend.averageCash)}</span></div>
          {spend.hungryMarkets.length > 0 && (
            <div className="small" style={{ color: 'var(--amber)', marginTop: 4 }}>
              💡 Hungry markets: {spend.hungryMarkets.join(', ')} — unmet demand
              beat sales yesterday.
            </div>
          )}
        </div>
        <div className="card" style={{ minWidth: 240, marginBottom: 0 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>Where it went (yesterday)</div>
          {spend.spendByProduct.length === 0 && <div className="muted small">no sales yet</div>}
          {spend.spendByProduct.map((p) => {
            const max = spend.spendByProduct[0]!.amount;
            return (
              <div className="row small" key={p.productId} style={{ gap: 6 }}>
                <span style={{ width: 70 }}>{p.name}</span>
                <span className="bar" style={{ flex: 1 }}>
                  <span style={{ width: `${(p.amount / max) * 100}%` }} />
                </span>
                <span className="mono" style={{ width: 70, textAlign: 'right' }}>{formatMoney(p.amount)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <h3>Labor Market</h3>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div className="card" style={{ minWidth: 220, marginBottom: 0 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>
            <FormulaTooltip title="Skill distribution" explanation="Workers gain skill with tenure (crews produce at average skill, up to 1.3×). Poach veterans with a 15%+ wage premium.">Skill distribution</FormulaTooltip>
          </div>
          {labor.skillBuckets.map((b) => (
            <div className="row small" key={b.label} style={{ gap: 6 }}>
              <span className="mono" style={{ width: 70 }}>{b.label}</span>
              <span className="bar" style={{ flex: 1 }}>
                <span style={{ width: `${(b.count / maxBucket) * 100}%` }} />
              </span>
              <span className="mono" style={{ width: 22, textAlign: 'right' }}>{b.count}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ minWidth: 180, marginBottom: 0 }}>
          <div className="kv small"><span className="k">Wage min</span><span className="mono">{formatMoney(labor.wageMin)}</span></div>
          <div className="kv small"><span className="k">Wage median</span><span className="mono">{formatMoney(labor.wageMedian)}</span></div>
          <div className="kv small"><span className="k">Wage max</span><span className="mono">{formatMoney(labor.wageMax)}</span></div>
          <div className="kv small">
            <span className="k"><FormulaTooltip title="Luxury aspirants" explanation="Citizens currently craving pastries or jewelry (satisfied, well-off). Your luxury market size.">Luxury aspirants</FormulaTooltip></span>
            <span className="mono">{labor.luxuryAspirants}</span>
          </div>
        </div>
        <div className="card" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
          <table>
            <thead><tr><th>Employer</th><th>Staff</th><th>Avg skill</th><th>Base wage</th></tr></thead>
            <tbody>
              {employers.map((e) => (
                <tr key={e.firmId} style={{ fontWeight: e.isPlayer ? 700 : 400, color: e.isPlayer ? 'var(--accent)' : undefined }}>
                  <td>{e.name}{e.isPlayer ? ' (you)' : ''}</td>
                  <td className="mono">{e.employees}</td>
                  <td className="mono">{e.employees > 0 ? `${e.avgSkill.toFixed(2)}×` : '—'}</td>
                  <td className="mono">{formatMoney(e.baseWage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h3>Citizens</h3>
      <div className="scroll" style={{ maxHeight: '50vh' }}>
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Activity</th><th>Cash</th><th>Wage</th><th>Skill</th><th>Satisfaction</th></tr></thead>
          <tbody>
            {citizens.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => select(c.id)}>
                <td>{c.name}</td>
                <td>{c.employmentStatus}</td>
                <td>{citizenActionLabel(c)}</td>
                <td className="mono">{formatMoney(c.cash)}</td>
                <td className="mono">{formatMoney(c.wage)}</td>
                <td className="mono">{c.skill.toFixed(2)}×</td>
                <td className="mono">{c.satisfaction.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div className="card" style={{ minWidth: 130, marginBottom: 0 }}>
      <div className="muted small">
        {hint ? <FormulaTooltip title={label} explanation={hint}>{label}</FormulaTooltip> : label}
      </div>
      <div className="mono" style={{ fontSize: 16 }}>{value}</div>
    </div>
  );
}
