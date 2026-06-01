import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { populationStats, allCitizens, citizenActionLabel } from '../sim/selectors/citizenSelectors';
import { formatMoney } from '../utils/formatMoney';

export function PopulationDashboard(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const select = useGameStore((s) => s.select);
  const state = sim.getState();
  const pop = populationStats(state);
  const citizens = allCitizens(state);

  return (
    <div>
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

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="card" style={{ minWidth: 130, marginBottom: 0 }}>
      <div className="muted small">{label}</div>
      <div className="mono" style={{ fontSize: 16 }}>{value}</div>
    </div>
  );
}
