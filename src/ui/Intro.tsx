import React from 'react';
import { useGameStore } from '../store/useGameStore';

/** First-run welcome / how-to-play overlay. Re-openable via the ? button. */
export function Intro(): React.ReactElement | null {
  const show = useGameStore((s) => s.showIntro);
  const setShow = useGameStore((s) => s.setShowIntro);
  if (!show) return null;

  return (
    <div className="intro-backdrop" onClick={() => setShow(false)}>
      <div className="intro-card" onClick={(e) => e.stopPropagation()}>
        <h1>🏙 EconSim</h1>
        <p className="muted">A living town economy — a Capitalism Lab in miniature.</p>

        <div className="intro-grid">
          <div>
            <h4>The world runs itself</h4>
            <p>40 citizens work, earn wages, and shop. Three AI companies run
              <strong> bread</strong>, <strong>tools</strong>, and
              <strong> clothes</strong> chains (farm/mine → factory → store).
              World events — booms, droughts, crazes — shake things up; watch
              the news chips on the map.</p>
          </div>
          <div>
            <h4>Inspect anything</h4>
            <p>Click a building, citizen, or truck. Drag to pan, scroll to zoom.
              Hover any underlined number to see the formula behind it. Open the
              dashboards (top bar) for Company, Market, Supply Chain & Population.</p>
          </div>
          <div>
            <h4>Run your company</h4>
            <p>Follow the <strong>Missions</strong> panel (left) — it walks you
              from first build to market dominance and pays cash rewards. Build,
              pick recipes, set prices, hire, and wire <strong>supply
              contracts</strong>. Earn <strong>Awards</strong> along the way.</p>
          </div>
          <div>
            <h4>Compete on three levers</h4>
            <p><strong>Brand</strong> — advertise to make customers pay more &amp;
              choose you. <strong>Quality</strong> — invest in R&amp;D for better
              goods. <strong>Finance</strong> — borrow to expand, buy rival
              shares, or <strong>acquire competitors outright</strong>. The AI
              fights back with new outlets where demand is unmet.</p>
          </div>
        </div>

        <button className="intro-go" onClick={() => setShow(false)}>Enter the town →</button>
      </div>
    </div>
  );
}
