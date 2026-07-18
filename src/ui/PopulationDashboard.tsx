import React from 'react';
import { useGameStore } from '../store/useGameStore';
import {
  populationStats,
  allCitizens,
  citizenActionLabel,
  laborMarketStats,
  employerBreakdown,
} from '../sim/selectors/citizenSelectors';
import { macroIndicators } from '../sim/selectors/debugSelectors';
import { formatMoney } from '../utils/formatMoney';
import { FormulaTooltip } from './FormulaTooltip';

export function PopulationDashboard(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const select = useGameStore((s) => s.select);
  const state = sim.getState();
  const pop = populationStats(state);
  const macro = macroIndicators(state);
  const citizens = allCitizens(state);
  const labor = laborMarketStats(state);
  const employers = employerBreakdown(state);
  const maxBucket = Math.max(1, ...labor.skillBuckets.map((b) => b.count));

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
