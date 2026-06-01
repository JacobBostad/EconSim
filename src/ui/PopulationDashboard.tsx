import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { populationStats, allCitizens, citizenActionLabel } from '../sim/selectors/citizenSelectors';
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

      <h3>Citizens</h3>
      <div className="scroll" style={{ maxHeight: '50vh' }}>
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Activity</th><th>Cash</th><th>Wage</th><th>Satisfaction</th></tr></thead>
          <tbody>
            {citizens.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => select(c.id)}>
                <td>{c.name}</td>
                <td>{c.employmentStatus}</td>
                <td>{citizenActionLabel(c)}</td>
                <td className="mono">{formatMoney(c.cash)}</td>
                <td className="mono">{formatMoney(c.wage)}</td>
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
