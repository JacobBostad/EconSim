import React from 'react';
import { useGameStore, type DashboardTab } from '../store/useGameStore';
import { computeTime } from '../sim/core/Tick';
import { seasonOf, daysLeftInSeason, SEASON_META } from '../sim/data/seasons';
import { formatTime } from '../utils/formatTime';
import { formatMoney } from '../utils/formatMoney';
import { getPlayerFirm, companyValuation, playerRank, dailyInsight } from '../sim/selectors/companySelectors';
import { populationStats } from '../sim/selectors/citizenSelectors';
import { formatMoneyShort } from '../utils/formatMoney';

const TABS: { id: DashboardTab; label: string }[] = [
  { id: 'company', label: 'Company' },
  { id: 'market', label: 'Market' },
  { id: 'supply', label: 'Supply Chain' },
  { id: 'population', label: 'Population' },
  { id: 'awards', label: 'Awards' },
  { id: 'gazette', label: 'Gazette' },
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
  const insight = dailyInsight(state, state.playerFirmId);

  return (
    <div className="topbar">
      <span className="title">EconSim</span>
      <div className="stat">
        <span className="label">Time</span>
        <span className="value mono">{formatTime(time)}</span>
      </div>
      <div className="stat" title={`${SEASON_META[seasonOf(state)].name} — ${daysLeftInSeason(state)} days left. Farms slow in winter; clothes sell hot.`}>
        <span className="label">Season</span>
        <span className="value">{SEASON_META[seasonOf(state)].icon} {SEASON_META[seasonOf(state)].name}</span>
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
      {insight && (
        <div
          className="stat"
          title={`Day ${insight.day}: revenue ${formatMoney(insight.revenue)}${insight.breakdown
            .map((b) => ` − ${b.label} ${formatMoney(b.amount)}`)
            .join('')} = ${formatMoney(insight.net)} net.${
            insight.topCostAmount > 0 ? ` Biggest cost: ${insight.topCostLabel}.` : ''
          } Click for the full ledger.`}
          style={{ cursor: 'pointer' }}
          onClick={() => setDashboard('company')}
        >
          <span className="label">Yesterday</span>
          <span className="value mono" style={{ color: insight.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {insight.net >= 0 ? '+' : ''}{formatMoneyShort(insight.net)}
            {insight.deltaVsPrior !== 0 && (
              <span className="small muted"> {insight.deltaVsPrior > 0 ? '▲' : '▼'}</span>
            )}
          </span>
        </div>
      )}
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
