import React from 'react';
import { loadChallengeRuns, challengeShareText, dailyDateFromSeed, challengeWorldLabel, CHALLENGE_WORLDS, type ChallengeRun, type ChallengeWorld } from './records';
import { formatMoneyShort } from '../utils/formatMoney';
import { SCENARIOS } from '../sim/data/scenarios';
import { SHOW_CHRONICLE_EVENT } from './ChronicleModal';
import { useGameStore } from '../store/useGameStore';
import { ACHIEVEMENT_DEFS } from '../sim/data/achievements';

/** Awards tab — unlocked achievements in color, locked ones dimmed with hints. */
export function AwardsDashboard(): React.ReactElement {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  const unlockedBy = new Map(state.achievements.map((a) => [a.id, a.day]));
  const unlockedCount = state.achievements.length;

  return (
    <div>
      <p className="muted small">
        {unlockedCount}/{ACHIEVEMENT_DEFS.length} unlocked. Achievements are permanent for this town
        and are saved with the game.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {ACHIEVEMENT_DEFS.map((def) => {
          const day = unlockedBy.get(def.id);
          const unlocked = day !== undefined;
          return (
            <div
              key={def.id}
              className="card award-card"
              style={{ opacity: unlocked ? 1 : 0.45 }}
            >
              <div className="award-icon">{unlocked ? def.icon : '🔒'}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{def.name}</div>
                <div className="muted small">{unlocked ? def.description : def.hint}</div>
                {unlocked && <div className="small" style={{ color: 'var(--green)' }}>Unlocked on day {day + 1}</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => window.dispatchEvent(new Event(SHOW_CHRONICLE_EVENT))}>
          📜 Town Chronicle — the story so far
        </button>
      </div>

      <div className="section-title">🏁 Challenge Leaderboard</div>
      <p className="muted small">
        Scores compare best within the same world scale, town, and difficulty —
        a Village 200-day run and a City one are different games (the City run
        carries the whole crowd economy), so each world keeps its own board.
        Terrain tilts identical play by roughly ±15%, about as much as seed luck.
        🏅 marks your best run in each town.
      </p>
      {(() => {
        const boards = CHALLENGE_WORLDS
          .map((world) => ({ world, runs: loadChallengeRuns(world) }))
          .filter((b) => b.runs.length > 0);
        if (boards.length === 0) {
          return (
            <p className="muted small">
              No finished challenge runs yet — start one from the New Game dialog
              (final score at day 200).
            </p>
          );
        }
        return boards.map((b) => <ChallengeBoard key={b.world} world={b.world} runs={b.runs} />);
      })()}
    </div>
  );
}

/** One world scale's leaderboard table (Village / City / Metropolis). */
function ChallengeBoard({ world, runs }: { world: ChallengeWorld; runs: ChallengeRun[] }): React.ReactElement {
  // Each scenario's best run gets a medal — terrain shifts scores a little
  // (measured: ~±15% for identical play), so the per-town best is the fairer
  // brag. Bests are per-world (this board only holds one world's runs).
  const bestByScenario = new Map<string, number>();
  for (const r of runs) {
    if ((bestByScenario.get(r.scenarioId) ?? -1) < r.score) {
      bestByScenario.set(r.scenarioId, r.score);
    }
  }
  return (
    <div style={{ marginTop: 6 }}>
      <div className="small" style={{ fontWeight: 700, marginBottom: 2 }}>
        {world === 'village' ? '🏘️' : world === 'city' ? '🌆' : '🏙️'} {challengeWorldLabel(world)}
      </div>
      <table>
        <thead>
          <tr><th>#</th><th>Score</th><th>Valuation</th><th>Town</th><th>Difficulty</th><th>Seed</th><th>Date</th><th></th></tr>
        </thead>
        <tbody>
          {runs.map((r, i) => (
            <tr key={`${r.seed}-${r.at}-${i}`}>
              <td>{i + 1}{i === 0 ? ' 🏆' : ''}</td>
              <td className="mono">{r.score}</td>
              <td className="mono">{formatMoneyShort(r.valuation)}</td>
              <td>
                {SCENARIOS[r.scenarioId]?.name ?? r.scenarioId}
                {bestByScenario.get(r.scenarioId) === r.score && (
                  <span title="Your best score in this town"> 🏅</span>
                )}
              </td>
              <td>{r.difficulty}</td>
              <td className="mono">
                {dailyDateFromSeed(r.seed) ? (
                  <span title={`Daily challenge ${dailyDateFromSeed(r.seed)} — everyone raced this town that day`}>📅 {dailyDateFromSeed(r.seed)}</span>
                ) : (
                  r.seed
                )}
              </td>
              <td className="muted small">{r.at}</td>
              <td>
                <button
                  title="Copy a shareable summary"
                  onClick={() => void navigator.clipboard?.writeText(
                    challengeShareText(r, SCENARIOS[r.scenarioId]?.name ?? r.scenarioId),
                  )}
                >
                  📋
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
