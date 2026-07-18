# Commodity Desk — Pillar 3 design

Offworld Trading Company's lesson: a price chart the player can ACT on in
both directions is a game in itself. EconSim already has the hard part —
two trade cities walking anti-correlated daily prices in a 0.6×–1.8× band
(`TradeCitySystem`, `data/tradeCities.ts`) — but the player can only sell
into it. Buying was one-directional (the flat-priced importer at a fixed
1.25× markup). That leaves *spatial* arbitrage (route exports to the
better port) and forfeits *temporal* arbitrage (buy the dip, hold, sell
the spike) — the move every trading game is built on.

## Phase 1 — buy from the cities (SHIPPED)

`BUY_FROM_CITY {firmId, facilityId, productId, quantity, cityId}`:

- Warehouses only — storage is the natural position limit (combined
  input+output units vs `storageCapacity`), and staging in a warehouse is
  what lets the goods flow back out through the existing export path.
- Unit cost = `cityPrice × (1 + exportFreightFee(city))` — the same
  freight the sell side pays, symmetric and fuel-sensitive. Money books
  firm → world as `importPurchase`; conservation holds.
- Goods arrive at the product's `defaultQuality` (same convention as the
  flat importer).
- **The AI does not buy speculatively** — this is deliberately a player
  edge, like the wizard. AI firms already broker their surpluses out.

UI: a **Commodity desk** row on the warehouse inspector — product picker,
quantity, and one button per city quoting the delivered cost (price +
freight) against base, colored when it's a genuine dip.

## Viability probe (pre-implementation)

300-day run, seed 11, mechanical bot on the real recorded walks: buy 200
units when a city quotes ≤0.8× base, sell when ≥1.3× (either city), both
legs paying freight:

| buy-side freight | 300d profit | round-trips | avg capital tied | ROI/300d |
| --- | --- | --- | --- | --- |
| 8% (symmetric, shipped) | $8,008 | 14 | $10,567 | **76%** |
| 15% | $6,444 | 14 | $11,255 | 57% |
| 25% | $4,212 | 14 | $12,236 | 34% |

76%/300d is the *ceiling* for a perfectly disciplined bot running every
product across both cities with free storage — real players pay warehouse
build cost (~$4k) and daily maintenance, spot fewer dips, and tie capital
they'd otherwise put into retail (which compounds). Symmetric 8% freight
makes speculation a genuinely profitable sideline that does not dominate
operating a business, so no extra buy-side penalty was added.

## Later phases

- Forward contracts (sell goods you don't hold yet at today's price —
  shorting with a delivery deadline and a default penalty).
- A speculation achievement (buy under 0.8×, sell the same lot over 1.4×).
- Market-moving world events with pre-announcements ("Ironvale tool
  tender next week") so reading the news becomes a trading skill.
- Gazette coverage of big player trades.
