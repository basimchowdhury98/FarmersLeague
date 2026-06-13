Use `data-test` attributes for Cypress UI selectors and select them with `cy.testGet('selector-name')`.

Scraper API overview:
- `src/FarmersLeague.Scraper` is a separate API used by `src/FarmersLeague.Api` through the `WorldCupScraper` HTTP client.
- The main app calls the scraper for World Cup games, confirmed lineups, and player stats.
- `/api/matches` should stay lightweight: it lists matches without fetching lineups.
- Draft-specific API calls fetch lineups for the selected match, so the draft page has starters and bench data.

Scraper mock mode:
- Enable with `FotMob__MockMode=true` in Docker/env config, or `--FotMob:MockMode=true` when running the scraper directly.
- Mock mode returns one upcoming match, starting about 30 minutes from now, with confirmed starting 11s and full benches.
- The scraper player-stats endpoint simulates live updates: each call advances through a 10-step scripted stat series, then keeps returning the final step.
- Validation runs containers with `USE_SCRAPER_MOCK_MODE=true`, which Docker Compose maps to `FotMob__MockMode=true`, then runs Cypress acceptance tests.
