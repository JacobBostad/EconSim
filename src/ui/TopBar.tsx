import React from 'react';
import { useGameStore, type DashboardTab } from '../store/useGameStore';
import { computeTime } from '../sim/core/Tick';
import { formatTime } from '../utils/formatTime';
import { formatMoney } from '../utils/formatMoney';
import { getPlayerFirm, companyValuation, playerRank } from '../sim/selectors/companySelectors';
import { populationStats } from '../sim/selectors/citizenSelectors';
import { formatMoneyShort } from '../utils/formatMoney';

const TABS: { id: DashboardTab; label: string }[] = [
  { id: 'company', label: 'Company' },
  { id: 'market', label: 'Market' },
  { id: 'supply', label: 'Supply Chain' },
  { id: 'population', label: 'Population' },
  { id: 'awards', label: 'Awards' },
  { id: 'debug', label: 'Debug' },
];

export function TopBar(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const dashboard = useGameStore((s) => s.dashboard);
  const setDashboard = useGameStore((s) => s.setDashboard);
  const setShowIntro = useGameStore((s) => s.setShowIntro);
  const state = sim.getState();
  const time = computeTime(state.tick, state.config);
  const player = getPlayerFirm(state);
  const pop = populationStats(state);
  const health = Math.round((pop.averageSatisfaction + pop.employmentRate * 100) / 2);
  const val = companyValuation(state, state.playerFirmId);
  const rank = playerRank(state);

  return (
    <div className="topbar">
      <span className="title">EconSim</span>
      <div className="stat">
        <span className="label">Time</span>
        <span className="value mono">{formatTime(time)}</span>
      </div>
      <div className="stat">
        <span className="label">Your Cash</span>
        <span className="value mono" style={{ color: (player?.cash ?? 0) < 0 ? 'var(--red)' : 'var(--green)' }}>
          {player ? formatMoney(player.cash) : '—'}
        </span>
      </div>
      <div className="stat">
        <span className="label">Company Value</span>
        <span className="value mono">{formatMoneyShort(val.valuation)}</span>
      </div>
      <div className="stat">
        <span className="label">Rank</span>
        <span className="value mono" style={{ color: rank.rank === 1 ? 'var(--green)' : undefined }}>
          #{rank.rank}/{rank.total}
        </span>
      </div>
      <div className="stat">
        <span className="label">Economy</span>
        <span className="value mono">{health}% · {pop.employed}/{pop.total} jobs</span>
      </div>

      <span className="spacer" />

      {TABS.map((t) => (
        <button
          key={t.id}
          className={dashboard === t.id ? 'active' : ''}
          onClick={() => setDashboard(dashboard === t.id ? 'none' : t.id)}
        >
          {t.label}
        </button>
      ))}
      <button onClick={() => setShowIntro(true)} title="How to play">?</button>
    </div>
  );
}
