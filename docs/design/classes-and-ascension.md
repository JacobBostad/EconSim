# Classes & Ascension — Pillar 1 design

The market-research conclusion (July 2026): the deepest gap between EconSim
and Capitalism Lab is **market segmentation** — Cap Lab consumers split into
income classes and stores position against them, so "who am I selling to?"
is a strategic identity. Anno 1800's beloved loop is the complement:
**population ascension**, where citizens climb tiers and each tier unlocks
new demand. EconSim's named citizens (wages, homes, skills, satisfaction —
machinery Cap Lab's statistical consumers don't have) let us fuse the two:
citizens visibly climb a prosperity ladder, and their tier changes what,
how much, and at what price they buy.

## Tiers

Three tiers, stored on the citizen (`tier`), derived daily with hysteresis:

| Tier | Fiction | Entry bar (all required) | Floor (drop below → demotion clock) |
| --- | --- | --- | --- |
| `worker` | Getting by | (default — everyone starts here) | — |
| `comfortable` | Steady life | employed · satisfaction ≥ 60 · (wage ≥ $18/day **or** cash ≥ $250) | employed · satisfaction ≥ 45 · (wage ≥ $16 **or** cash ≥ $150) |
| `affluent` | Prospering | employed · satisfaction ≥ 70 · (wage ≥ $26/day **or** cash ≥ $350) · (apartment resident **or** cash ≥ $600) | employed · satisfaction ≥ 55 · (wage ≥ $22 **or** cash ≥ $250) |

- **Hysteresis**: meet the next tier's entry bar for **5 consecutive days**
  (7 for affluent) to ascend; fail your own tier's floor for **5 consecutive
  days** to drop one tier. One bad day never demotes anyone; a payday bump
  never instantly gentrifies the town. Tracked as a single signed
  `tierStreak` counter (+ toward promotion, − toward demotion).
- Wage thresholds are stated in dollars/day and defined relative to
  `subsistenceIncomePerDay` ($14) in code so difficulty presets scale them.
- New citizens (immigration, fund-home) start as `worker`.
- **Numbers above are probe-calibrated** (see "Phase 1 probe results"
  below). Target shape for a healthy unattended town: roughly 50–70%
  worker / 25–40% comfortable / 5–15% affluent, with visible movement over
  a run. The savings OR-routes exist because the unattended labor market
  has zero wage dispersion — wage-only bars strand the whole town in
  `worker` (the probe proved it).

## What tiers change (later phases — Phase 1 changes nothing)

**Phase 2 — tiered demand (SHIPPED).** Per-tier scaling on need urgency
growth (purchase frequency, not basket size) plus affluent price-cap
tolerance. **Strictly additive above the worker baseline** — the original
draft cut worker coffee/clothes (×0.6–0.9), and every probed variant of
that contracted the whole town ~10% by day 300 (less revenue → cafés shed
staff → immigration stalls); see "Phase 2 probe results" below. Shipped
table:

| Product | worker | comfortable | affluent |
| --- | --- | --- | --- |
| bread | ×1 | ×1 | ×1, price cap ×1.1 |
| tools | ×1 | ×1 | ×1 |
| coffee | ×1 | ×1 | ×1.5, cap ×1.2 |
| clothes | ×1 | ×1 | ×1.4, cap ×1.2 |
| pastries (luxury) | ×0 | ×0.5 | ×1.5 |
| jewelry (luxury) | ×0 | ×0.3 | ×1.5 |

The luxury ×0/×0.5 ladder **replaces** the old satisfaction+cash
aspiration gate in SatisfactionSystem: the tier ladder is the aspiration
signal now, and its hysteresis means new money takes a week to become new
tastes. Bot floors needed no re-baseline — aggregate demand is conserved
by construction.

**Phase 3 — store positioning (SHIPPED).** A per-store lever
`positioning: discount | standard | premium`, with one governing rule the
probes forced: **a sign must be earned or it does nothing.**
- *discount*: earned by genuinely undercutting (price ≤ 95% of the market
  average). Earns +worker / −affluent store-score affinity. The draft's
  "price image" walkaway penalty (shoppers refuse >85% of cap at discount
  stores) was probed to be toxic: in low-competition towns the AI's
  controller couldn't honor the sign, and the chronic walkaways cost the
  town −5 satisfaction / −20% population. Earned-by-price replaced it.
- *premium*: earned by shelf quality ≥ 60. Earns +affluent/+comfortable /
  −worker affinity and a 15% higher walkaway cap.
- AI adoption (deterministic, once per store): price_fighter → discount,
  brand_builder → premium when their quality reaches the bar.
- Contested-market A/B (day 120 town, player store vs incumbent, same
  price/stock): premium flipped the store's clientele from 21 workers/0
  comfortable to 3 workers/4 comfortable/1 affluent — and halved revenue in
  a worker-majority town. Positioning against the town's tier mix is a real
  strategic decision, exactly the Cap-Lab-style segmentation the pillar
  wanted. Unattended 4-seed probe with AI adoption: pop/sat within noise of
  the Phase-2 baseline (69.3/57.2 vs 72.5/58.1).

**Phase 4 — ascension as spectacle.** Gazette lines and toasts when
citizens climb ("Wade Garin moved up — steady wages at the tool works"),
tier counts in town history charts, tier-colored citizen dots, ascension
achievements (achievements only — the mission chain is sequential).

## Save compatibility

Old saves: `tier` derived on migration from a one-shot snapshot heuristic
(the same entry bars as the live system, checked top-down: affluent, then
comfortable, else worker), `tierStreak = 0`. Golden saves v1–v4 must load
with sensible tiers; goldenSave tests extended.

## Engine placement & determinism

A new `TierSystem` runs at the day boundary after `SatisfactionSystem` and
before `TownStatsSystem` (so history can record tier counts later). Rules
are pure functions of citizen state — **no `ctx.rng` draws**, so inserting
the system does not shift the shared rng stream and Phase 1 re-deals
nothing.

## Build order

1. **Phase 1 (this commit)**: tier + streak on Citizen, TierSystem
   derivation with hysteresis, migration defaults, Population dashboard
   tier card, tests, 300-day distribution probe documented here.
2. Phase 2 (shipped): tiered demand — additive design meant no bot
   re-baseline was needed.
3. Phase 3: store positioning lever + AI adoption + probes.
4. Phase 4: spectacle (gazette/toasts/charts/achievements) + media refresh.

## Phase 1 probe results

300-day unattended runs (no player input), seeds 11 and 4, standard config.

**First cut failed hard**: with wage-only entry bars (comfortable = wage ≥
$18/day), **100% of citizens stayed `worker` at day 300 in both seeds** —
zero promotions ever. Diagnosis: the unattended labor market converges to a
single town wage of exactly $16/day with *zero dispersion* (wage
p10 = p50 = p90 = max = $16 in both seeds). Wage is not a differentiating
signal unless the player pays above market. What actually spreads is
**savings**: citizen cash at day 300 ran p50 ≈ $225, p90 ≈ $880,
max ≈ $3.8k. Satisfaction spreads too (p10 ≈ 45, p50 ≈ 61, p90 ≈ 81+).
Hence the savings OR-routes in the bars above — wealth is the natural
climb; above-market wages are the player-made shortcut.

A second finding: satisfaction and savings are *anti-correlated* at the top
(spenders get their needs met and are happy; hoarders aren't), so the
original affluent bar (satisfaction ≥ 75 **and** cash ≥ $600) selected a
nearly empty joint — 1% of the town. Affluent satisfaction relaxed to 70.

**Final distribution with the shipped bars** (hysteresis active):

| Seed | Day 100 | Day 200 | Day 300 |
| --- | --- | --- | --- |
| 11 | 36% / 57% / 7% | 48% / 46% / 6% | 64% / 32% / 4% |
| 4 | 51% / 44% / 5% | 58% / 42% / 0% | 61% / 36% / 3% |

(worker / comfortable / affluent; populations 41–80.) Inside the target
shape of 50–70 / 25–40 / 5–15, with affluent at the lean end — deliberate:
affluent is the aspirational tier the *player* unlocks for their town by
paying above-market wages and building apartments. The worker share
*rising* over time is immigration at work: newcomers arrive as workers
faster than incumbents climb, which gives Phase 2's tiered demand a natural
late-game texture (a broad worker base plus a comfortable middle).

## Phase 2 probe results

300-day unattended A/B, seeds 11/4/7/21, day-300 population and average
satisfaction vs the Phase-1 baseline (avg pop 72.5, avg sat 59.0):

| Variant | worker coffee/clothes | comfortable | avg pop | avg sat |
| --- | --- | --- | --- | --- |
| draft (seeds 11/4 only) | ×0.6 / ×0.8 | ×1 | 58.5 (−23% vs those seeds) | 59.3 |
| softened | ×0.85 / ×0.9 | ×1.1 both | 65.3 (−10%) | 56.4 |
| ends-only | ×0.9 / ×0.9 | ×1 coffee, ×1.1 clothes | 64.0 (−12%) | 55.6 |
| **additive (shipped)** | **×1 / ×1** | **×1** | **72.5 (±0%)** | **58.1** |

Every variant that trimmed worker staple demand contracted the town —
the retail economy is calibrated to the all-citizens baseline, and a
per-capita cut compounds (lower revenue → downsizing → fewer jobs →
slower immigration). Boosting comfortable to compensate just moved the
damage to stockout-driven satisfaction loss. The additive design keeps
towns statistically indistinguishable from baseline while affluent
citizens and the luxury ladder still create real per-tier texture: in one
probe seed an AI luxury boutique found paying customers among comfortable
citizens (pastries moving unattended for the first time).
