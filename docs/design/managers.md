# Managers & Delegation — Pillar 2 design

Market-research conclusion (July 2026): Big Ambitions' most-loved system is
**delegation** — the game begins hands-on and *earns* its scale by letting
the player hire people to run what they've built. EconSim's late game has
the same tedium curve: by three stores and two chains, daily price checks
and shelf-sizing are chores. The fix is not more automation toggles — it's
**named, salaried characters** the player hires, pays, and can lose.

## Shape

A `Manager` is not a citizen — they're an off-map professional:

```ts
interface Manager {
  id: string;
  name: string;            // from the town name pools
  role: 'store';           // Phase 1; later: 'logistics', 'sales'
  skill: number;           // 0.9–1.3, sets the duty set and the salary
  salaryPerDay: number;    // cents, paid at the day boundary
  facilityId: FacilityId;  // the store they run
  hiredAtTick: number;
}
```

Stored on the firm (`firm.managers`), migrated as `?? []`.

## Phase 1 — the Store Manager

Runs ONE assigned retail store, reusing the exact subroutines the AI and
the player's per-product auto-price toggle already use — a manager is the
per-facility generalization of `autoPriceByProduct`:

| Duty | Mechanism | Requires |
| --- | --- | --- |
| Pricing | `adjustPrices` scoped to the store's products | any manager |
| Shelf-sizing | `maybeWidenShelves` scoped to the store's contracts | skill ≥ 1.05 |
| Marketing | trim ads while the store loses money; step toward a $25/day cap while profitable and share < 50% | skill ≥ 1.15 |

Because product prices are firm-wide, a manager pricing "their" store's
products effectively prices those products chain-wide — same semantics as
the existing auto-price toggle, documented in the UI.

**Candidates.** Three named candidates (junior / seasoned / veteran bands)
are derivable at any time as a pure function of `(seed, week)` — the same
stream-safe hash trick as rush orders, zero `ctx.rng` draws, no stored
candidate state. The market refreshes weekly; better candidates cost more
($16–20 / $24–30 / $34–42 a day against measured small-store revenues of
$90–200/day).

**Salary** books daily as `wages` (firm → world) via `recordTransaction`,
so money stays conserved and the P&L shows the cost of delegation. A firm
that cannot cover payday loses the manager on the spot (payroll event) —
managers are not loyal to sinking ships.

**Commands**: `HIRE_MANAGER {firmId, facilityId, candidateIndex}` (retail,
firm-owned, one manager per store) and `FIRE_MANAGER {firmId, managerId}`.

**Engine placement**: `ManagerSystem` at the day boundary right after
`AIStrategySystem`. With no managers hired it does nothing and draws no
rng, so inserting it re-deals nothing; once hired, its duties draw from
`ctx.rng` exactly like the auto-price path already does (hiring is a
player action — player actions always re-deal the stream).

## Later phases

- **Logistics manager** (firm-wide): keeps supply contracts sized, swaps
  importer contracts to cheaper wholesale — the `manageSourcing` slice.
- **Sales manager** (firm-wide): standing exports tuned to port spreads,
  rush orders accepted and staged automatically.
- Manager quality drift: skill grows slowly on the job (mirrors crew
  skill), poaching-style salary reviews.

## Phase 1 probe

A 100-day A/B on a scripted player store (built day 20, stocked via
contract): unmanaged with hand-set launch price vs manager-run. The
manager must keep the store profitable after salary and beat the
set-and-forget baseline. Results recorded below after implementation.

## Phase 1 probe results

100-day A/B, seed 11: wizard bread chain built at day 20 with a launch
blunder (bread priced at 2× base, auto-price off), firm-level cash delta
including the chain's build cost:

| Variant | day-120 price | sold/day | firm cash delta |
| --- | --- | --- | --- |
| hands-off | $7.00 (never fixed) | 0 | **−$15,101** |
| junior manager ($17/day) | $4.34 | 18 | **−$2,342** |
| veteran manager ($39/day) | $4.09 | 26 | −$4,170 |

The junior manager rescued the mispriced launch for a ~$12.8k swing. The
veteran moved more units but their doubled salary and ad spend didn't pay
for itself in a one-store market — seniority is for scale, not for a
corner shop. A second probe fact worth keeping: an importer-supplied
bread store has *negative unit margins* in every variant (the Mill
Country money-pit signal) — a manager makes a bad business lose money
faster by running it well; delegation is not a substitute for a sound
supply chain.
