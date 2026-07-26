# Loan interest — pricing the rate like a real economy

## The complaint

A playtester (the owner) took a **$40,000** loan and watched **$36/day** of
interest drain off — `40000_00 × 0.0009 = 3600_00` cents/day. That is
**32.9%/yr** (simple), and they had to reverse-engineer it from the daily drain
because the game shows the dollar cost but never the rate. Their read: that is
credit-card pricing, not a business loan. A loan in this world should read like
**inflation + a bank's margin + a risk premium**, and the number should be
*shown*, not inferred.

The rate is a single flat literal — `interestRatePerDay = 0.0009` — written at
six sites (`startingScenario.ts:132`, `seedTown.ts:307`, the four
`AIFounderSystem.ts` founder constructors) plus the `migrations.ts:217`
normalize fill. `FinanceSystem.ts:36`
multiplies it by outstanding principal each day and pays the interest to the
world (bank) account.

## What the probe actually found

`docs/design/probes/interest-rate.ts` (re-runnable:
`npx tsx docs/design/probes/interest-rate.ts`) measured the three pinned worlds
over 300 days. The headline result reframes the whole task.

### Finding 1 — nobody borrows. The rate is dead code in every pinned world.

| world | AI founders | peak debt | total borrowed | interest / revenue |
|---|---|---|---|---|
| village 11 | 3 | **$0** | **$0** | 0.0% |
| village 4 | 3 | **$0** | **$0** | 0.0% |
| village 7 | 3 | **$0** | **$0** | 0.0% |
| city-flagoff 11 | 9 | **$0** | **$0** | 0.0% |
| city-fullflag 11 | 18 | **$0** | **$0** | 0.0% |

Every AI founder arrives with founding capital from outside the town
(`AIFounderSystem` funds the starter chain from cash) and every subsequent
expansion is **cash-financed** — the expansion-loan branch in
`ai/expansion.ts:108` (borrow when `cash < cost × 1.3`) never fires at these
seeds, because AI operators are never that cash-constrained when they expand,
and `manageDebt` (`ai/finance.ts`) would deleverage any bridge within days
anyway. The interest transaction is gated on `firm.debt > 0`, so **at these
seeds it never executes.** The player firm in a headless run is passive, so it
never borrows either.

The task's premise — "with no term/amortization, the rate is the ONLY brake on
leverage" — is therefore only half true. It is the only brake **on the player**.
The AI's brake is that it self-funds and deleverages; the rate is inert for it.

### Finding 2 — the rate change cannot move a single pin.

Because the interest transaction is gated on `debt > 0` and **no pinned firm
ever carries debt**, the rate is a value the sim reads zero times on the pinned
paths. Verified directly: re-running village 11 and flag-off city 11 with the
per-firm rate patched to an absurd **0.5/day** reproduces the house-rule pins
**byte-for-byte**:

```
village 11  rate=0.5   rng 3274842624 SAME   money 315400000 SAME   maxDebt 0
city 11     rate=0.5   rng 2546912297 SAME   money 316900000 SAME   maxDebt 0
```

(Pins: village 11 → `3274842624`; city 11 → `2546912297` / `$3,169,000.00`.) The
re-pin blast radius of any rate change — flat *or* formula — is **zero for the
rngState/money pins**, because the code that consumes the rate is unreachable on
those paths.

The nine golden fixtures (`golden-save-v1…v9.json`) also carry **zero debt** on
every firm, and loading + running them forward never triggers a borrow (same
self-funding dynamics). So they survive a `FinanceSystem` change untouched too.

### Finding 3 — the rate is not the exploit boundary; the credit limit is.

The number the rate must beat to stop free-money leverage is the **operating
return on the capital a loan would fund** — annualized operating profit ÷
facility book value. Pooled across all 27 operator firms in the status-quo runs:

```
operating ROIC (annualized):  min -589%   p25 -101%   median 130%   p75 427%   max 1808%
current rate line = 32.9%/yr:  15/27 firms (56%) sit ABOVE it
```

For a healthy chain (`bread`/`coffee`/`clothes` chain = $7,400 build; `tools` =
$8,200), operating ROIC runs **130–430%/yr** — four to thirteen times the
current interest rate. Borrowing to build one more outlet into a real shortage
(the only condition `ai/expansion.ts` builds under: `unmetDemand > 14`) is
**already strictly +EV at 32.9%/yr** for the majority of firms. The flat rate
does not deter the leverage exploit; the **1.5× net-worth credit limit**
(`LOAN_CREDIT_LIMIT_MULTIPLE`, `Simulation.ts:745`) is the actual cap. Firms
below the line (saturated or losing money — the negative tail) would lose money
borrowing, and correctly don't.

So the rate is being asked to do two contradictory jobs with one number: read
like a *realistic cost* (the owner wants it lower) **and** be the *deterrent
against maxing leverage* (which at any single flat value it fails to be, because
ROIC is dispersed from −589% to +1808% — no one rate is right for both a
distressed firm and a boom chain). This is the real design hole.

### Finding 4 — no secular inflation to price in.

Money is conserved (interest and loan draws both route through
`WORLD_ACCOUNT`), and the staple price level is flat across the whole run
(~$9 mean across bread/tools/clothes/coffee, versus a $6.75 base-price mean) and
**identical across every swept rate**. The `worldEvents` boom/slump cycle moves
prices transiently but there is no secular drift. The "inflation" term of a
realistic rate is, in this economy, **~0–2%/yr**. That argues for a *low* base.

## The decision

| candidate | what it does | verdict |
|---|---|---|
| **(a) flat, lower + amortization/term** | drop base to ~10%/yr; add a repayment schedule that forces paydown | **defer.** Correct real-finance answer, but needs a term/schedule/payment-cadence machinery, a save-shape addition (`loanTermDays`, `nextPaymentDay`), and new AI repayment behavior. Heavy for the hole it fills. A lower flat rate *without* a term makes the free-money problem in Finding 3 **worse** (cheaper permanent debt). |
| **(b) risk-tiered: base + spread × leverage** | cheap first dollar, expensive last dollar; spread from `debt / loanNetWorth` (the credit limit's own liquid basis, shared code) | **ship.** A leverage-priced REPRICING, not a new deterrent — the spread rises toward the old rate as leverage approaches the credit limit, but the LOAN_CREDIT_LIMIT_MULTIPLE cap (Finding 3's real brake) is what bounds the exploit, unchanged. Reuses the exact collateral basis the credit limit computes today (`loanNetWorth` = cash + inventory at base prices, extracted into one shared function so the two can never drift), and directly answers the owner: the first bridge dollar reads realistic, maxing leverage stays as costly as today. |
| **(c) cycle-linked base** | base shifts with the `worldEvents` boom/slump cycle (booms cheap, slumps dear) | **phase-2 additive.** Good flavor and couples to an existing system, but it is a *seasoning* on the base, not the structural fix. Layer it onto (b)'s base once (b) has landed. |

**Chosen shape: (b) risk-tiered, with (c) reserved as a later additive on the
base term.**

### The formula

Replace the flat all-in rate with a base ("prime", the rate on the first dollar)
plus a leverage spread computed at accrual:

```
leverage      = debt / max(loanNetWorth, MIN_NET_WORTH)          // 0 when unlevered
effectiveRate = BASE_RATE + SPREAD_SLOPE × clamp(leverage, 0, LEVERAGE_CAP)
dailyInterest = round(debt × effectiveRate)
```

Constants **derived from the measurements** (Findings 3–4):

| constant | value | annual | rationale |
|---|---|---|---|
| `BASE_RATE` | `0.0003` /day | **≈ 11%/yr** | inflation (~0–2%, Finding 4) + bank margin + baseline risk. Reads like a real small-business loan — the first dollar of the owner's bridge. |
| `SPREAD_SLOPE` | `0.0004` /day per unit leverage | up to **+22%/yr** | tuned so that at the credit-limit leverage (1.5) the all-in rate returns to **exactly 0.0009 = 32.9%/yr** — the deep-leverage deterrent is *unchanged* from today, preserving Finding 3's ceiling. |
| `LEVERAGE_CAP` | `1.5` | — | equals `LOAN_CREDIT_LIMIT_MULTIPLE`; measured on the SAME liquid basis the limit prices against (shared `loanNetWorth`), the spread saturates at the limit's multiple. Honest dynamics: leverage is debt over CURRENT liquid worth — a firm still holding borrowed cash sits below its draw-time ratio; one that spent a maxed line into buildings pays the full ceiling. Encumbrance, not the draw, is what the spread prices. |
| `MIN_NET_WORTH` | `dollars(5000)` | — | equals `LOAN_MIN_CREDIT`; a near-zero-net-worth firm (receivership) is priced against the same floor the credit line uses, not a divide-by-zero. |

Resulting curve:

| leverage (debt ÷ net worth) | effective rate/day | annual | reads as |
|---|---|---|---|
| 0.0 (first bridge dollar) | 0.00030 | **11%** | a real business loan |
| 0.33 (owner's $40k on ~$120k net worth) | 0.00043 | **16%** | ≈ **$17/day**, half of today's $36 |
| 1.0 | 0.00070 | 26% | leverage getting expensive |
| 1.5 (maxed to the credit limit) | 0.00090 | **33%** | the old flat rate — the exploit ceiling, unchanged |

The owner's specific loan drops from $36/day to ~$17/day *and* the number now
reads like inflation-plus-margin-plus-risk, while a firm that borrows all the way
to its credit limit still pays today's ceiling rate. Stated plainly (the review's
point, kept honest here): this is a REPRICING that makes low-leverage debt
cheaper — and therefore makes early borrow-and-build strictly MORE +EV than
today for the 56% of firms whose ROIC clears even the old 33% line. The curve
does not strengthen the leverage brake; the unchanged 1.5x credit limit is and
remains the sole bound on exploit magnitude. That trade is accepted knowingly:
the limit already caps the damage, and the realism win is the point.

### Where it lives in code (SHIPPED — phases 1+2)

- **`FinanceSystem.ts:36`** stops reading `firm.interestRatePerDay` as the
  all-in rate and instead computes `effectiveRate` from the firm's `debt` and
  `loanNetWorth(state, firm.id)` (cash + inventory at base prices — the ONE
  shared function `Simulation.takeLoan`'s credit limit also delegates to, so
  the coupling is structural, not aspirational — holdings excluded, so a
  marked-up equity book can't cheapen leverage). `firm.interestRatePerDay`
  becomes the **base** the firm was quoted (its "prime"), not the all-in cost.
- **The four founder constructors + `startingScenario`/`seedTown`** reprice the
  stored base literal `0.0009 → 0.0003` for **new** firms.
- **`migrations.ts:217`** — the normalize default `?? 0.0009` fills only *absent*
  fields (pre-field saves), so it can flip to `?? 0.0003` freely; saves that
  already carry a base keep it. Repricing *existing* saved firms' base is a
  one-line versioned `v3→v4` step (`f.interestRatePerDay = 0.0003`) — exactly the
  "repricing is normalize-level" the field was built for.

### UI surfacing — the reverse-engineering was itself the defect

The owner should never have to divide $36 by $40,000. Four exact touchpoints,
all of which are a **pure win even if the rate stays flat** (they only add a
displayed number), so they land in phase 1:

1. **`src/ui/EntityInspector.tsx` — `FinanceControls` (line ~428).** The
   "Borrow $5k / $20k" buttons show no rate at all. Label them with the
   **effective annual rate for the next dollar** at the firm's current leverage,
   e.g. *"Borrow $20k — 16%/yr at your current leverage"*, and a hint that the
   rate rises as debt approaches the credit limit.
2. **`src/ui/ReceivershipModal.tsx` — the emergency-loan button (line ~98).** A
   firm in receivership has near-zero `loanNetWorth`, so its leverage is
   high and its emergency loan is priced near the 33% ceiling — the player must
   see that this bridge is expensive *because* they are distressed, so *"a loan
   only buys time if the losses continue"* (existing copy) is quantified.
3. **`src/sim/selectors/advisorSelectors.ts` — the debt-service line (line ~74).**
   Already names the dollar cost; append the effective annual rate so the advisor
   reads *"…cost $36/day (33%/yr on maxed leverage) — deleverage to drop the
   rate."*
4. **`src/ui/CompanyDashboard.tsx` — the Debt card (line ~284).** Annotate the
   debt figure with the firm's current effective rate.

## Re-pin cost and the landing plan

The blast radius is unusually small because of Finding 2.

| artifact | moves? | why |
|---|---|---|
| village 11/4/7 rngState pins | **no** | no firm borrows → interest transaction never fires → rate is read zero times (verified at rate 0.5/day). |
| city 11 flag-off rngState + money pins | **no** | same. |
| full-flag city founder/tier bands | **no** | AI self-funds and deleverages; peak debt $0 across the whole run. |
| golden fixtures v1–v9 | **no** | every fixture firm has `debt = 0`; running them forward never borrows. |
| the interest suite / conservation | **no** | interest still routes through `WORLD_ACCOUNT`; money stays conserved to the cent (probe asserts drift 0). |

Nothing on the pinned list needs re-minting for the **behavioral** change,
because the behavior it changes (interest on debt) is absent from every pinned
world. A pin would only move if a *new* test deliberately drives a firm into
debt — which is exactly what the new formula's own unit tests should do, on
their own fresh seeds, off the pinned set.

**Phased landing:**

1. **Phase 1 — formula + UI, dark behind a flag. — SHIPPED.** Added
   `riskTieredInterestEnabled: false` to `SimulationConfig` (`DEFAULT_CONFIG`
   false; normalize default false in `migrations.ts`). The formula lives in
   `src/sim/systems/interestRates.ts` (`effectiveInterestRatePerDay`,
   `chargedInterestRatePerDay`, `effectiveRateForLeverage/ForDebt`,
   `firmLeverage`, `annualRatePercent`). `FinanceSystem.ts:36` now charges
   `chargedInterestRatePerDay(firm, state)`: flag **off** → the flat
   `firm.interestRatePerDay` (byte-identical to today, verified); flag **on** →
   `base + spread`. All four UI surfacings landed unconditionally (they only
   *display*, showing the flat rate at a flat rate). Unit tests
   (`interestRates.test.ts`) assert the curve: **0.0003 at leverage 0 (11%/yr)**,
   **exactly 0.0009 at leverage 1.5 (33%/yr)**, clamp above the cap, the
   `MIN_NET_WORTH` floor, monotone between. This is the `servicesEnabled` /
   `realEstateEnabled` house pattern applied to finance.
2. **Phase 2 — new games opt in. — SHIPPED.** `worldScaleConfig` sets
   `riskTieredInterestEnabled: true` for New Games at **every** preset (the
   `useGameStore` New Game path). The stored per-firm base literal stays `0.0009`
   for now (it is the firm's quoted "prime"; the formula reads leverage live) —
   repricing the stored base is Phase 3's versioned migration, unshipped. Because
   no AI founder or passive player borrows on the pinned paths, the four pins are
   **bit-identical flag-on vs flag-off**, verified in `interestRates.test.ts` and
   measured directly:

   | pin | flag OFF | flag ON | verdict |
   |---|---|---|---|
   | village 11 rngState | `3274842624` | `3274842624` | identical |
   | village 4 rngState | `2896139677` | `2896139677` | identical |
   | village 7 rngState | `4253583594` | `4253583594` | identical |
   | city 11 rngState / money | `2546912297` / `316900000` | `2546912297` / `316900000` | identical |

   A flag-on player-loan scenario test charges the tiered rate day-by-day and
   asserts money conserved to the cent. `playtestV8`'s bot never borrows (no
   `TAKE_LOAN` in its script), so its P&L floor bands are untouched — no re-pin.
3. **Phase 3 — reprice existing saves (optional).** A versioned `v3→v4`
   migration sets `f.interestRatePerDay = 0.0003` on load so in-progress games
   inherit the cheaper base. This is the only step that changes a loaded game's
   behavior, and only for firms actually carrying debt — a strict improvement for
   the player, gated by an explicit save-version bump.
4. **Phase 4 (later) — cycle-linked base (candidate c).** Make `BASE_RATE` a
   function of the current `worldEvents` boom/slump phase (cheap in booms, dear
   in slumps), layered on top of the leverage spread. Additive; no shape change.

The design keeps the change reviewable: the formula lands inert, the UI number
lands independently useful, and the pins — verified unreachable by the rate —
never have to be re-minted to prove the refactor is safe.

## Measurements

Full grid from `docs/design/probes/interest-rate.ts`, 300 days:

```
--- PART A: STATUS QUO @ rate 0.0009 (32.9%/yr) ---
world                foundr  ins/dst   ROIC%  ROICmed    borrow$     peak$  int/rev%  spellD  brg/opn   price$
village 11                3      0/0   -37.0    -43.1          0         0       0.0       0      0/0        9
village 4                 3      0/0   146.6    148.5          0         0       0.0       0      0/0       10
village 7                 3      0/0   192.5     27.2          0         0       0.0       0      0/0       10
city-flagoff 11           9      0/0   211.8     29.5          0         0       0.0       0      0/0        9
city-fullflag 11         18      0/0   824.3    385.6          0         0       0.0       0      0/0        9

  ** AI/passive-player debt across ALL status-quo worlds: ZERO **

  Operating ROIC dispersion across all operator firms (annualized, %):
    n=27  min -589  p25 -101  median 130  p75 427  max 1808
    15/27 firms (56%) sit ABOVE the current rate line.

--- PART B: RATE SWEEP (exploit boundary) — flag-off city 11 & village 11 ---
  Every metric is FLAT across 0.0002 / 0.0004 / 0.0006 / 0.0009: borrow$ = peak$
  = firmDaysInDebt = 0 at every rate, founders and price unchanged. The sweep is
  flat BY CONSTRUCTION — the rate has no lever to pull because debt is never taken.
```

(Pin-invariance cross-check — rate patched to 0.5/day — reproduces
`3274842624` / `2546912297` / `$3,169,000.00` byte-for-byte.)
