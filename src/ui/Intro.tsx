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

        <div className="card" style={{ margin: '10px 0 14px', padding: '10px 14px' }}>
          <h4 style={{ margin: '0 0 8px' }}>Your first ten minutes</h4>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>
              Click <strong>🚀 Bread chain</strong> in the left panel — you get a
              farm, a bakery, and a shop: built, staffed, wired, and priced.
            </li>
            <li>
              Set speed <strong>20×</strong> and watch the money move — green
              popups are sales, and the 🧭 <strong>Advisor</strong> (right)
              flags anything going wrong.
            </li>
            <li>
              Follow the <strong>Missions</strong> panel (top left) — each one
              pays cash and teaches one lever of the game.
            </li>
          </ol>
        </div>

        <p className="muted small" style={{ marginBottom: 6 }}>
          The deep game — skim now, come back with the <strong>?</strong> button:
        </p>
        <div className="intro-grid">
          <div>
            <h4>The world runs itself</h4>
            <p>Citizens work, earn wages, and shop. Rival firms with named
              CEOs run <strong>bread</strong>, <strong>tools</strong>, and
              <strong> clothes</strong> chains — nobody serves
              <strong> coffee</strong> yet. Citizens climb a
              <strong> prosperity ladder</strong> (🔧 worker → 🏠 comfortable →
              🥂 affluent) and each rung shops differently — court a tier by
              hanging a 🏷️ <strong>Discount</strong> or ✨
              <strong> Premium</strong> sign on your store (earn it: real low
              prices, or real quality). Prosperous towns attract newcomers;
              a neglected one 🧳 <strong>loses families</strong> — and one
              scenario, 🏚️ <strong>Dust Hollow</strong>, opens mid-exodus.
              Watch the ladder in <strong>Population</strong>. Pick your
              <strong> world scale</strong> in New Game: a 🌆 <strong>City</strong>
              grows a crowd of hundreds as <strong>district × tier cohorts</strong>
              beyond your named cast.</p>
          </div>
          <div>
            <h4>Trade, seasons, and the town</h4>
            <p>Export to <strong>Port Rosa</strong> or industrial
              <strong> Ironvale</strong> — the Gazette's Trade Desk shows which
              port pays, and a warehouse unlocks the whole trading game:
              <strong> rush orders</strong> on a deadline, the 📈
              <strong> commodity desk</strong> (buy dips, hold, export
              spikes — big trades move the market), and
              <strong> forwards</strong> that lock today's spike for delivery
              within the week. Brace for <strong>winter</strong>, sponsor
              <strong> festivals</strong>, and unlock
              <strong> luxury</strong> with R&amp;D.</p>
          </div>
          <div>
            <h4>Run your company</h4>
            <p>Follow the <strong>Missions</strong> panel (left) — it pays cash
              rewards. Run a <strong>general store</strong> (up to 3 products —
              shoppers buy whole baskets), source shelves
              <strong> wholesale</strong> from rivals — or become the town's
              supplier. Tired of daily price checks? 🤝 <strong>Hire
              managers</strong>: a store manager runs pricing and shelves,
              and the 👔 <strong>executive team</strong> (logistics, sales)
              delegates the rest — salaried, skilled, and gone the day you
              can't pay them.</p>
          </div>
          <div>
            <h4>Compete on every lever</h4>
            <p><strong>Brand</strong> (ads), <strong>quality</strong> (R&amp;D),
              <strong> wages</strong> (out-pay rivals by 15% to poach their
              veterans — they answer back — or 🎓 <strong>train</strong> your
              own crew up from the facility view), <strong>finance</strong> (loans,
              shares, outright <strong>acquisitions</strong> — and 🏷️
              <strong> fire-sale bargains</strong> in the ticker when a rival
              stumbles), and
              <strong> real estate</strong> (apartments collect rent — or
              <strong> lease</strong> your premises from a landlord instead of
              building). A <strong>City</strong> grows specialist rivals too:
              <strong> landlords</strong>, stock-holding <strong>holdcos</strong>,
              and 🖥 <strong>datacenter</strong> service firms. The
              🧭 <strong>Advisor</strong> card tells you what needs attention;
              press <strong>F</strong> to see supply chains flow. Want a score?
              Start a 🏁 <strong>Challenge run</strong> — or the 📅
              <strong> Daily challenge</strong>, where everyone on Earth races
              the same town today.</p>
          </div>
        </div>

        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          Keys: <strong>Space</strong> pause · <strong>1–4</strong> speed ·
          <strong> arrows</strong> pan · <strong>±</strong> zoom ·
          <strong> G</strong> gazette · <strong>C</strong> company ·
          <strong> M</strong> market · <strong>A</strong> awards ·
          <strong> F</strong> supply flows · <strong>Esc</strong> close
        </p>
        <button className="intro-go" onClick={() => setShow(false)}>Enter the town →</button>
      </div>
    </div>
  );
}
