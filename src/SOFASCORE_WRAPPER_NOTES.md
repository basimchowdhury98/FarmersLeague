# SofaScore / ScraperFC Notes

## What It Is

ScraperFC is a Python library that wraps several football data sources, including SofaScore.

For SofaScore, ScraperFC is not a hosted service and does not provide its own API key. It calls SofaScore's public/internal JSON endpoints and returns Python dictionaries or pandas DataFrames.

Project docs:

- https://scraperfc.readthedocs.io/en/latest/sofascore.html

Relevant package usage:

```python
from ScraperFC import Sofascore

ss = Sofascore()
```

## Recommended Use In This Project

Use ScraperFC as a reference for endpoint discovery and data shape, but call SofaScore directly from our API.

Reasons:

- This scraper API package is already Node/Newman-based.
- Direct SofaScore calls avoid Python subprocess or microservice complexity.
- ScraperFC source confirms the underlying endpoints we need.
- We still need to normalize SofaScore responses into the app's match and draft response models.

## Auth

SofaScore's internal JSON endpoints currently do not require a login, bearer token, or API key.

Use browser-like request headers:

```http
User-Agent: Mozilla/5.0 ...
Accept: application/json
Referer: https://www.sofascore.com/
```

Observed behavior in this environment:

- `curl` succeeds against SofaScore endpoints.
- Node built-in `fetch` receives `403 Forbidden` for some SofaScore API calls.
- This appears to be request fingerprinting, not authentication.
- The probe script falls back to `curl` when Node `fetch` gets `403`.

## World Cup 2026 IDs

SofaScore identifiers verified for FIFA World Cup 2026:

```text
FIFA World Cup unique tournament ID: 16
World Cup 2026 season ID: 58210
```

Season lookup endpoint:

```text
GET https://api.sofascore.com/api/v1/unique-tournament/16/seasons/
```

Fixture paging endpoint for future/upcoming matches:

```text
GET https://api.sofascore.com/api/v1/unique-tournament/16/season/58210/events/next/{page}
```

Current probe result:

```text
104 unique World Cup 2026 events
104 events with both teams
104 events with venue objects
```

Run the local probe:

```bash
npm run probe:worldcup
```

Export full fixture JSON:

```bash
npm run probe:worldcup:json
```

Output file:

```text
data/world-cup-2026-games.json
```

## ScraperFC Methods

Common ScraperFC SofaScore methods:

```python
ss.get_valid_seasons("FIFA World Cup")
ss.get_match_dicts(year="2026", league="FIFA World Cup")
ss.get_match_dict(match_id)
ss.get_match_player_ids(match_id)
ss.scrape_team_match_stats(match_id)
ss.scrape_player_match_stats(match_id)
ss.scrape_match_shots(match_id)
ss.scrape_match_momentum(match_id)
ss.scrape_player_average_positions(match_id)
ss.scrape_heatmaps(match_id)
```

ScraperFC returns raw match dictionaries for event data and pandas DataFrames for many stats methods.

## Useful SofaScore Endpoints

For a SofaScore event ID, these endpoints are useful:

```text
GET /api/v1/event/{eventId}
GET /api/v1/event/{eventId}/lineups
GET /api/v1/event/{eventId}/statistics
GET /api/v1/event/{eventId}/incidents
GET /api/v1/event/{eventId}/shotmap
GET /api/v1/event/{eventId}/graph
GET /api/v1/event/{eventId}/average-positions
GET /api/v1/event/{eventId}/player/{playerId}/heatmap
```

Base URL:

```text
https://api.sofascore.com/api/v1
```

## Fixture Data Available

The World Cup fixture/event payload contains:

- SofaScore event ID
- slug and custom ID
- start timestamp
- home team
- away team
- status
- score fields when available
- tournament/group/round
- venue and city
- team colors
- team country metadata
- ranking for national teams when available
- `hasEventPlayerStatistics`

Example fields:

```json
{
  "id": 15186710,
  "date": "2026-06-11T19:00:00.000Z",
  "home": "Mexico",
  "away": "South Africa",
  "status": {
    "code": 0,
    "description": "Not started",
    "type": "notstarted"
  },
  "tournament": "FIFA World Cup, Group A",
  "venue": "Estadio Azteca",
  "city": "Mexico City"
}
```

## Status Data

SofaScore event statuses include numeric `code`, text `description`, and `type`.

Observed/documented examples:

```text
0   Not started
6   1st half
7   2nd half
31  Halftime
60  Postponed
70  Canceled
100 Ended
110 After extra time
120 After penalties
```

These can be mapped to the API-Football status values in `API_FOOTBALL_WORLD_CUP_SPEC.md`.

## Live Match Data Verified

Test match checked:

```text
Portugal vs Nigeria
International Friendly Games
SofaScore event ID: 16135568
Observed status: Halftime
Observed score: Portugal 1 - 1 Nigeria
```

The following live endpoints returned usable data:

```text
GET /api/v1/event/16135568
GET /api/v1/event/16135568/lineups
GET /api/v1/event/16135568/statistics
GET /api/v1/event/16135568/incidents
GET /api/v1/event/16135568/shotmap
```

## Live Player Stats Available

Live player stats are available under:

```text
GET /api/v1/event/{eventId}/lineups
```

Each team has a `players` array. Each player entry can include:

- player identity
- team ID
- shirt number
- position
- starter/substitute flag
- live `statistics`

Verified live player statistic keys include:

```text
accurateCross
accurateLongBalls
accurateOppositionHalfPasses
accurateOwnHalfPasses
accuratePass
aerialLost
aerialWon
ballRecovery
bigChanceCreated
bigChanceMissed
blockedScoringAttempt
dispossessed
duelLost
duelWon
fouls
goalAssist
goals
interceptionWon
keyPass
minutesPlayed
onTargetScoringAttempt
outfielderBlock
rating
saves
shotOffTarget
totalClearance
totalContest
totalCross
totalLongBalls
totalOffside
totalPass
totalShots
totalTackle
touches
wasFouled
wonContest
wonTackle
```

This covers the requested player stat categories:

- passing: `totalPass`, `accuratePass`, long balls, own-half/opposition-half passes
- key passes: `keyPass`
- chances created: `bigChanceCreated`
- blocked shots: `blockedScoringAttempt`, `outfielderBlock`
- shots: `totalShots`, `onTargetScoringAttempt`, `shotOffTarget`
- defensive actions: `totalTackle`, `interceptionWon`, `duelWon`, `ballRecovery`
- goalkeeping: `saves`, `goodHighClaim`, keeper-specific fields when applicable

Example live player data:

```json
{
  "team": "Portugal",
  "name": "Nelson Semedo",
  "position": "D",
  "substitute": false,
  "statistics": {
    "totalPass": 28,
    "accuratePass": 24,
    "keyPass": 1,
    "bigChanceCreated": 1,
    "totalShots": 0,
    "totalTackle": 1,
    "duelWon": 4,
    "rating": 6.9,
    "minutesPlayed": 49
  }
}
```

## Team Match Stats Available

Team stats are available under:

```text
GET /api/v1/event/{eventId}/statistics
```

The response is grouped by period and stat group. Live Portugal/Nigeria data included:

- ball possession
- big chances
- total shots
- goalkeeper saves
- corner kicks
- fouls
- passes
- tackles
- free kicks

The endpoint may return `404` before a match has stat data.

## Incidents / Timeline Data Available

Timeline data is available under:

```text
GET /api/v1/event/{eventId}/incidents
```

This can include:

- goals
- assists
- cards
- substitutions
- period markers
- injury time
- score at incident time
- player objects

Before kickoff, this endpoint can return an empty `incidents` array while still returning team color metadata.

## Shot Map Data Available

Shot data is available under:

```text
GET /api/v1/event/{eventId}/shotmap
```

The shot map can include:

- player
- team side
- shot type/result
- situation
- body part
- coordinates
- goalkeeper
- blocking player/context
- time and added time
- expected goals fields when available

## Data Lifecycle Notes

For future matches:

- `/event/{id}` works.
- `/lineups` may work before kickoff and can include squads/expected lineups.
- `/incidents` may return an empty array.
- `/statistics` may return `404` until stats exist.

For live matches:

- `/event/{id}` gives current status, score, and clock metadata.
- `/lineups` gives live player stats.
- `/statistics` gives live team stats.
- `/incidents` gives live timeline events.
- `/shotmap` gives shot-level data.

For completed matches:

- The same endpoints should provide final scores, timeline, lineups, player stats, team stats, and shot map when SofaScore has coverage.

## Caveats

SofaScore internal endpoints are not an official public API contract.

Risks:

- endpoint shapes can change
- request fingerprinting can block some HTTP clients
- rate limits are undocumented
- some match data may appear only shortly before kickoff or once the match starts
- live data should be polled, not treated as a push stream

Recommended polling strategy:

- future fixtures: cache for 10-30 minutes
- match day fixtures: cache for 1-5 minutes
- live fixtures: cache for 15-30 seconds
- completed fixtures: cache for hours/days
