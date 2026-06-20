# FarmersLeague

Minimal shell for a World Cup friends league app.

## Stack

- .NET API serving the production Angular app
- Angular web UI
- FotMob-backed scraper services for World Cup data
- Cypress e2e test
- Docker/Render-ready app image

## Local Docker Run

```sh
make run
```

Open `http://localhost:8080`.

## Cypress

To start the app with mock scraper data and run all Cypress tests:

```sh
make val
```

## Services

- App: `http://localhost:8080`
- Scraper-backed matches: `http://localhost:8080/api/matches`

## Completed Game Stats Explorer

Run the terminal stats explorer from the repo root:

```sh
dotnet run --project tools/FarmersLeague.StatsExplorer
```

Or create a local `.env` file with `Redis__ConnectionString=<prod redis connection string>` and run:

```sh
make stat
```

It reads completed game keys matching `FarmersLeague:live-matches:*:completed`, lets you select one game, then shows squad totals, all player points, and optional per-player stat breakdowns.

For Upstash/production Redis:

```sh
dotnet run --project tools/FarmersLeague.StatsExplorer -- --redis "<UPSTASH_ENDPOINT>:<UPSTASH_PORT>,password=<UPSTASH_PASSWORD>,ssl=True,abortConnect=False"
```

You can also set `Redis__ConnectionString` instead of passing `--redis`, or jump directly to one match with `--game <match-id>`.

## Render

Use Render's free tier with one manually created Docker web service:

- `farmersleague-app`: public web service serving the Angular app and API
- Upstash Redis: external Redis store for users, drafts, and completed match state

Blueprints and Render private services are not required for the free setup.

### Upstash Redis

Create an Upstash Redis database, then copy the TCP connection details from the Upstash dashboard. Use the endpoint, port, and password/token to build the StackExchange.Redis connection string:

```text
<UPSTASH_ENDPOINT>:<UPSTASH_PORT>,password=<UPSTASH_PASSWORD>,ssl=True,abortConnect=False
```

Do not use `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN`; this app uses a TCP Redis client through `Microsoft.Extensions.Caching.StackExchangeRedis`.

### Render Free-Tier Service

1. Push this repo to GitHub.
2. Create `farmersleague-app`:
   - Service type: Web Service
   - Runtime: Docker
   - Plan: Free
   - Dockerfile path: `./Dockerfile`
   - Docker context: `.`
   - Health check path: `/api/hello`
   - Environment variables:

```text
ASPNETCORE_ENVIRONMENT=Production
PORT=8080
SeedTestUsers=false
FotMob__MockMode=false
FotMob__UseFixtureData=false
Redis__ConnectionString=<UPSTASH_ENDPOINT>:<UPSTASH_PORT>,password=<UPSTASH_PASSWORD>,ssl=True,abortConnect=False
```

3. After deploy, open the `farmersleague-app` URL and verify `/api/hello` returns a JSON response.

Free Render services can spin down after inactivity, so the first request can be slow while the app wakes up.

### Production Passkeys

Production seeds only the real users unless `SeedTestUsers=true` is set:

```text
Basim:  basim-e537-dc50-3bb8
Avi:    avi-79fa-1d3a-3460
Suyash: suyash-1efa-61d5-4fb3
```

`SeedTestUsers=true` additionally seeds Alice, Bob, and Carol for mock-mode test runs. Local Docker validation sets this automatically when `USE_SCRAPER_MOCK_MODE=true`.
