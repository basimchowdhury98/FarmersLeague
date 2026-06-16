Use `data-test` attributes for Cypress UI selectors and select them with `cy.testGet('selector-name')`.

Access control:
- Draft lifecycle permissions must be based on a user's admin flag, not a hard-coded user name like Alice.
- Seeded/test passkeys should use the formatted pattern `<name>-dddd-dddd-dddd`, such as `alice-1111-1111-1111`.

Scoring:
- Keep live player stat point multipliers in a config file; stats without configured point values should contribute 0 points.

Scraper API overview:
- `src/FarmersLeague.Scraper` contains in-process scraper services used by `src/FarmersLeague.Api` through `IWorldCupScraper` and `WorldCupGamesCache`.
- The main app calls the scraper services for World Cup games, confirmed lineups, and player stats.
- `/api/matches` should stay lightweight: it lists matches without fetching lineups.
- Draft-specific API calls fetch lineups for the selected match, so the draft page has starters and bench data.
- If the scraper services do not provide the right information for a scraper-backed feature, pause and ask for a scraper service update rather than deriving the behavior another way.

Scraper mock mode:
- Enable with `FotMob__MockMode=true` in Docker/env config, or `--FotMob:MockMode=true` when running the app directly.
- Mock mode returns one upcoming match, starting about 30 minutes from now, with confirmed starting 11s and full benches.
- The scraper player-stats service simulates live updates in mock mode: each call advances through a 10-step scripted stat series, then keeps returning the final step.
- Validation runs containers with `USE_SCRAPER_MOCK_MODE=true`, which Docker Compose maps to app `FotMob__MockMode=true`, then runs Cypress acceptance tests.
