import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { challengeScore, CHALLENGE_END_DAY, type ChallengeScore } from '../sim/selectors/reportSelectors';
import { recordChallengeRun, loadChallengeRuns, challengeShareText, challengeWorldLabel } from './records';
import { SCENARIOS } from '../sim/data/scenarios';
import { formatMoney, formatMoneyShort } from '../utils/formatMoney';
import { computeTime } from '../sim/core/Tick';

/**
 * Challenge mode's finish line: at day 200 the sim pauses and the run gets a
 * final 0–1000 score, recorded to the local leaderboard. The town keeps
 * living afterwards if the player chooses — only the scoring ends.
 */
export function FinalScoreModal(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const dispatch = useGameStore((s) => s.dispatch);
  const setShowNewGame = useGameStore((s) => s.setShowNewGame);
  const state = sim.getState();
  const day = computeTime(state.tick, state.config).day;
  const due = state.config.challengeMode && day >= CHALLENGE_END_DAY;
  const handled = useRef(false);
  const [result, setResult] = useState<{ score: ChallengeScore; rank: number } | null>(null);

  useEffect(() => {
    if (!due) {
      handled.current = false;
      return;
    }
    if (!handled.current) {
      handled.current = true;
      dispatch({ type: 'PAUSE' });
      const score = challengeScore(sim.getState());
      // The world scale IS the size preset — a City run records to and ranks
      // against the City board, never the Village one.
      const world = state.config.sizePreset;
      recordChallengeRun({
        score: score.total,
        valuation: score.valuation,
        scenarioId: state.scenarioId,
        difficulty: state.config.difficulty,
        seed: state.seed,
        world,
        at: new Date().toISOString().slice(0, 10),
      });
      const rank = loadChallengeRuns(world).findIndex((r) => r.score <= score.total) + 1;
      setResult({ score, rank: Math.max(1, rank) });
    }
  }, [due]);

  if (!result) return null;
  const s = result.score;

  const line = (label: string, pts: number, max: number, detail: string) => (
    <div className="kv small" key={label}>
      <span className="k">{label}</span>
      <span>
        <span className="mono">{pts}</span>
        <span className="muted">/{max}</span>
        <span className="muted"> · {detail}</span>
      </span>
    </div>
  );

  return (
    <div className="intro-backdrop">
      <div className="intro-card">
        <h2 style={{ margin: 0 }}>🏁 Challenge Complete — Day {CHALLENGE_END_DAY}</h2>
        <p style={{ margin: '8px 0', fontSize: 28, fontWeight: 700 }}>
          {s.total} <span className="muted" style={{ fontSize: 14 }}>/ 1000 · #{result.rank} on your {challengeWorldLabel(state.config.sizePreset)} leaderboard</span>
        </p>
        {line('Company valuation', s.valuationPts, 600, formatMoneyShort(s.valuation))}
        {line(
          state.config.sizePreset === 'village' ? 'Town satisfaction' : 'Town satisfaction (cast + crowd)',
          s.satisfactionPts, 150, `${s.satisfaction.toFixed(0)}/100`,
        )}
        {line('Peak market share', s.sharePts, 150, `${Math.round(s.peakShare * 100)}%`)}
        {line('Export revenue', s.exportPts, 100, formatMoney(s.exportRevenue))}
        {s.difficultyMult !== 1 && (
          <div className="kv small">
            <span className="k">Difficulty bonus</span>
            <span>
              <span className="mono">×{s.difficultyMult.toFixed(2)}</span>
              <span className="muted"> · {s.rawTotal} raw → {s.total}</span>
            </span>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          Same seed + scenario + world + difficulty replays identically — beat
          your line or challenge a friend to it. {challengeWorldLabel(state.config.sizePreset)} runs
          have their own board; the full leaderboard lives in Awards.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={() => {
              const text = challengeShareText(
                {
                  score: s.total, valuation: s.valuation, scenarioId: state.scenarioId,
                  difficulty: state.config.difficulty, seed: state.seed,
                  world: state.config.sizePreset, at: '',
                },
                SCENARIOS[state.scenarioId]?.name ?? state.scenarioId,
              );
              void navigator.clipboard?.writeText(text);
            }}
            title="Copy a paste-anywhere summary — the seed makes it a replayable dare"
          >
            📋 Copy result
          </button>
          <button onClick={() => { setResult(null); setShowNewGame(true); }}>
            New challenge
          </button>
          <button className="active" onClick={() => { setResult(null); dispatch({ type: 'RESUME' }); }}>
            Keep playing (sandbox)
          </button>
        </div>
      </div>
    </div>
  );
}
