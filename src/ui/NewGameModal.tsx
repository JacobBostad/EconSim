import React, { useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { Difficulty } from '../sim/core/SimulationConfig';
import { loadRecords, dailySeed } from './records';
import { SCENARIOS, DEFAULT_SCENARIO_ID } from '../sim/data/scenarios';
import { formatMoney } from '../utils/formatMoney';

interface Preset {
  id: Difficulty;
  name: string;
  icon: string;
  cash: string;
  blurb: string;
}

const PRESETS: Preset[] = [
  {
    id: 'relaxed',
    name: 'Relaxed',
    icon: '🌤️',
    cash: '$25,000',
    blurb: 'Deep pockets, calmer news cycle, laid-back rivals. Learn the ropes.',
  },
  {
    id: 'standard',
    name: 'Standard',
    icon: '⚖️',
    cash: '$15,000',
    blurb: 'The intended experience — balanced capital, events, and competition.',
  },
  {
    id: 'brutal',
    name: 'Brutal',
    icon: '🔥',
    cash: '$9,000',
    blurb: 'Thin capital, volatile news, aggressive AI expansion. Good luck.',
  },
];

/** New-game dialog: pick a difficulty preset and (optionally) a seed. */
export function NewGameModal(): React.ReactElement | null {
  const show = useGameStore((s) => s.showNewGame);
  const setShow = useGameStore((s) => s.setShowNewGame);
  const newGame = useGameStore((s) => s.newGame);
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const [seedText, setSeedText] = useState('');
  const [challenge, setChallenge] = useState(false);
  const [size, setSize] = useState<'cozy' | 'bustling'>('cozy');

  if (!show) return null;
  const records = loadRecords();

  const start = (): void => {
    const parsed = parseInt(seedText, 10);
    const seed = Number.isFinite(parsed)
      ? parsed
      : Math.floor(Math.random() * 1_000_000);
    newGame(seed, difficulty, scenarioId, challenge, size);
  };

  return (
    <div className="intro-backdrop" onClick={() => setShow(false)}>
      <div className="intro-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Start a new town</h2>
        <p className="muted small" style={{ marginTop: -6 }}>
          Your current town is auto-saved, but starting a new one replaces it.
        </p>
        <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`difficulty-card ${difficulty === p.id ? 'active' : ''}`}
              onClick={() => setDifficulty(p.id)}
            >
              <div style={{ fontSize: 20 }}>{p.icon}</div>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div className="mono small">{p.cash} start</div>
              <div className="small" style={{ opacity: 0.85 }}>{p.blurb}</div>
            </button>
          ))}
        </div>
        <div className="section-title">Town</div>
        <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
          {Object.values(SCENARIOS).map((sc) => (
            <button
              key={sc.id}
              className={`difficulty-card ${scenarioId === sc.id ? 'active' : ''}`}
              onClick={() => setScenarioId(sc.id)}
            >
              <div style={{ fontSize: 20 }}>{sc.icon}</div>
              <div style={{ fontWeight: 700 }}>{sc.name}</div>
              <div className="small" style={{ opacity: 0.85 }}>{sc.description}</div>
              <div className="muted small" style={{ marginTop: 4, fontStyle: 'italic' }}>{sc.society}</div>
            </button>
          ))}
        </div>
        {records.townsFounded > 0 && (
          <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
            🏅 Your records — towns founded: {records.townsFounded}
            {records.highestValuation > 0 && <> · best valuation: {formatMoney(records.highestValuation)}</>}
            {records.fastestTycoonDay !== null && <> · fastest Tycoon: day {records.fastestTycoonDay + 1}</>}
            {records.mostAchievements > 0 && <> · most awards: {records.mostAchievements}</>}
          </p>
        )}
        <div className="section-title">Town size</div>
        <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
          <button
            className={`difficulty-card ${size === 'cozy' ? 'active' : ''}`}
            onClick={() => setSize('cozy')}
          >
            <div style={{ fontSize: 20 }}>🏡</div>
            <div style={{ fontWeight: 700 }}>Cozy</div>
            <div className="small" style={{ opacity: 0.85 }}>Up to 40 homes / 80 citizens — the classic scale.</div>
          </button>
          <button
            className={`difficulty-card ${size === 'bustling' ? 'active' : ''}`}
            onClick={() => setSize('bustling')}
          >
            <div style={{ fontSize: 20 }}>🏙️</div>
            <div style={{ fontWeight: 700 }}>Bustling</div>
            <div className="small" style={{ opacity: 0.85 }}>Double the caps (80 homes / 160 citizens) on a taller map — bigger markets, bigger empires.</div>
          </button>
        </div>
        <label className="small" style={{ display: 'block', marginTop: 10 }}>
          <input type="checkbox" checked={challenge} onChange={(e) => setChallenge(e.target.checked)} />{' '}
          🏁 Challenge run — final score at day 200, recorded on your leaderboard
        </label>
        <p className="small muted" style={{ marginTop: 10 }}>
          Your current town is kept as a backup — “↩ Undo New” in the sidebar
          brings it back.
        </p>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <label className="small muted" htmlFor="seed-input">Seed (optional)</label>
          <input
            id="seed-input"
            placeholder="random"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            style={{ width: 110 }}
          />
          <span className="spacer" style={{ flex: 1 }} />
          <button onClick={() => setShow(false)}>Cancel</button>
          <button
            title="Everyone in the world races the SAME town today: seed = today's date (UTC), standard difficulty, the classic scenario, scored at day 200. Deterministic engine, no server — compare share strings."
            onClick={() => newGame(dailySeed(new Date()), 'standard', DEFAULT_SCENARIO_ID, true, 'cozy')}
          >
            📅 Daily challenge
          </button>
          <button className="active" onClick={start}>Start town</button>
        </div>
      </div>
    </div>
  );
}
