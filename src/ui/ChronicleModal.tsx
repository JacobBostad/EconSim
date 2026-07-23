import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { objectiveProgress } from '../sim/selectors/companySelectors';
import { currentDay } from '../sim/selectors/reportSelectors';
import { getAchievementDef } from '../sim/data/achievements';
import { OBJECTIVE_LADDER } from '../sim/data/constants';
import { CONSUMER_PRODUCT_IDS_BY_PRESET, getProduct } from '../sim/data/products';
import { Sparkline } from './Sparkline';
import { formatMoney } from '../utils/formatMoney';
import { townOf } from '../sim/core/Town';

/** Fired by the Company dashboard's Chronicle button after completion. */
export const SHOW_CHRONICLE_EVENT = 'econsim:show-chronicle';

/**
 * The Town Chronicle — the endgame retrospective. Auto-appears once when the
 * final objective (Business Empire) is reached, and reopens on demand via a
 * window event. Everything derives from state history.
 */
export function ChronicleModal(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const [show, setShow] = useState(false);
  const seenTiers = useRef<number | null>(null);
  const finalTier = OBJECTIVE_LADDER.length;

  const state = sim.getState();
  const prog = objectiveProgress(state);

  useEffect(() => {
    const open = (): void => setShow(true);
    window.addEventListener(SHOW_CHRONICLE_EVENT, open);
    return () => window.removeEventListener(SHOW_CHRONICLE_EVENT, open);
  }, []);

  useEffect(() => {
    if (seenTiers.current === null || prog.reachedTiers < seenTiers.current) {
      seenTiers.current = prog.reachedTiers; // baseline on mount / new game
      return;
    }
    if (prog.reachedTiers >= finalTier && seenTiers.current < finalTier) {
      setShow(true);
    }
    seenTiers.current = prog.reachedTiers;
  }, [prog.reachedTiers]);

  if (!show) return null;

  // The chronicle renders the home town (one-town region → identical reference);
  // it gains a town selector at the endgame move.
  const town = townOf(state);
  const player = town.firms[state.playerFirmId];
  const day = currentDay(state);
  const hist = player?.accounting.dailyHistory ?? [];
  const exportRev = player?.exportRevenue ?? 0;

  return (
    <div className="intro-backdrop" onClick={() => setShow(false)}>
      <div className="intro-card" onClick={(e) => e.stopPropagation()}>
        <h1 style={{ marginTop: 0 }}>📜 The Town Chronicle</h1>
        <p className="muted" style={{ marginTop: -8 }}>
          {player?.name ?? 'Your company'} —{' '}
          {prog.reachedTiers >= finalTier
            ? `a Business Empire in ${day + 1} days.`
            : `the story so far, day ${day + 1}.`}
        </p>

        {hist.length >= 2 && (
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="muted small">Company value, day by day</div>
            <Sparkline points={hist.map((d) => d.valuation)} width={560} height={80} color="var(--accent)" />
            <div className="mono small">{formatMoney(prog.valuation)} today</div>
          </div>
        )}

        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: 1, minWidth: 190, marginBottom: 0 }}>
            <div className="kv small"><span className="k">Employees</span><span className="mono">{player?.employees.length ?? 0}</span></div>
            <div className="kv small"><span className="k">Facilities</span><span className="mono">{player?.facilities.length ?? 0}</span></div>
            <div className="kv small"><span className="k">Export earnings</span><span className="mono">{formatMoney(exportRev)}</span></div>
            {state.emigrationDepartures > 0 && (
              <div className="kv small"><span className="k">🧳 Families lost</span><span className="mono">{state.emigrationDepartures}</span></div>
            )}
            {(player?.acquiredNames.length ?? 0) > 0 && (
              <div className="kv small"><span className="k">Acquired</span><span>{player!.acquiredNames.join(', ')}</span></div>
            )}
            <div className="kv small"><span className="k">Market share</span>
              <span className="mono small">
                {CONSUMER_PRODUCT_IDS_BY_PRESET[state.config.sizePreset]
                  .map((pid) => ({ pid, sh: player?.marketShareByProduct[pid] ?? 0 }))
                  .filter((x) => x.sh > 0.05)
                  .map((x) => `${getProduct(x.pid).name} ${(x.sh * 100).toFixed(0)}%`)
                  .join(' · ') || '—'}
              </span>
            </div>
          </div>
          <div className="card scroll" style={{ flex: 1, minWidth: 200, marginBottom: 0, maxHeight: 180 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>
              Milestones ({state.achievements.length})
            </div>
            {state.achievements.map((a) => {
              const def = getAchievementDef(a.id);
              return def ? (
                <div className="small" key={a.id}>
                  Day {a.day + 1}: {def.icon} {def.name}
                </div>
              ) : null;
            })}
          </div>
        </div>

        <p className="muted small" style={{ marginTop: 10 }}>
          The town keeps running — endless mode. Export your save to keep this
          chronicle, or start a new town and beat your record.
        </p>
        <button className="intro-go" onClick={() => setShow(false)}>
          Back to the empire →
        </button>
      </div>
    </div>
  );
}
