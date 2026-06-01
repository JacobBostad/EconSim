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
            <p>40 citizens work, earn wages, and shop. Two AI companies run a
              <strong> bread chain</strong> (farm → bakery → store) and a
              <strong> tools chain</strong> (mine → factory → store). Trucks move
              goods; <strong>+$</strong> popups show real sales.</p>
          </div>
          <div>
            <h4>Inspect anything</h4>
            <p>Click a building, citizen, or truck. Drag to pan, scroll to zoom.
              Hover any underlined number to see the formula behind it. Open the
              dashboards (top bar) for Company, Market, Supply Chain & Population.</p>
          </div>
          <div>
            <h4>Run your company</h4>
            <p>Start with <strong>$15,000</strong>. <strong>Build</strong> a Farm →
              Factory → Store, pick recipes, set prices, hire workers, and wire
              <strong> supply contracts</strong>. Compete on price, location and more.</p>
          </div>
          <div>
            <h4>Compete on three levers</h4>
            <p><strong>Brand</strong> — advertise to make customers pay more &amp;
              choose you. <strong>Quality</strong> — invest in R&amp;D for better
              goods. <strong>Finance</strong> — borrow to expand, repay before
              interest bites. (All on a store's inspector.) The AI uses these too —
              and will open new outlets where demand is unmet.</p>
          </div>
        </div>

        <button className="intro-go" onClick={() => setShow(false)}>Enter the town →</button>
      </div>
    </div>
  );
}
