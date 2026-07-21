# e2e smokes

Headless-browser checks against the production build (`vite preview`):

- `smoke.mjs` — boot, new game, wizard chain, dashboards, ~6s at 100×.
- `deepsmoke.mjs` — drives ~150 in-game days to a rich state, then opens
  every dashboard, inspectors, the flow overlay, and round-trips
  save/load. Asserts zero page errors.
- `citysmoke.mjs` — the only City (world-scale) smoke: starts a City game on a
  pinned seed, runs past the landlord threshold (~day 60), then exercises the
  era's panels — Population/Districts, Standings & Stock Market, a facility
  inspector, and the Build panel's lease-from-landlord option. Asserts zero
  page errors. Polls the day counter, so it is robust to machine speed.

```bash
npm run build && npx vite preview --port 4173 &   # serve dist/
npm run e2e          # quick smoke
npm run e2e:deep     # full gauntlet (~40s)
npm run e2e:city     # City / world-scale gauntlet (~30s)
```

Env: `BASE_URL` (default http://localhost:4173), `CHROMIUM_PATH` to point
at an existing Chromium instead of playwright-core's managed download.
