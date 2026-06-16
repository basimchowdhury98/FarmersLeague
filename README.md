# FarmersLeague

Minimal shell for a World Cup friends league app.

## Stack

- .NET API serving the production Angular app
- Angular web UI
- FotMob-backed scraper API for World Cup data
- Cypress e2e test
- Docker/Render-ready app image

## Local Docker Run

```sh
make run
```

Open `http://localhost:8080`.

## Cypress

To start the app with the scraper API and run all Cypress tests:

```sh
make val
```

## Services

- App: `http://localhost:8080`
- Scraper API: `http://localhost:5082/api/world-cup-2026/games`

## Render

This repo includes a `render.yaml` blueprint for production deployment:

- `farmersleague-app`: public Docker web service serving the Angular app and API
- `farmersleague-scraper`: private Docker service for FotMob scraping
- Upstash Redis: external Redis store for users, drafts, and completed match state

### Upstash Redis

Create an Upstash Redis database, then copy the TCP connection details from the Upstash dashboard. Use the endpoint, port, and password/token to build the StackExchange.Redis connection string:

```text
<UPSTASH_ENDPOINT>:<UPSTASH_PORT>,password=<UPSTASH_PASSWORD>,ssl=True,abortConnect=False
```

Do not use `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN`; this app uses a TCP Redis client through `Microsoft.Extensions.Caching.StackExchangeRedis`.

### Render Blueprint

1. Push this repo to GitHub.
2. In Render, create a new Blueprint from the repo.
3. When Render prompts for `Redis__ConnectionString`, paste the Upstash TCP connection string.
4. Create the Blueprint.
5. After deploy, open the `farmersleague-app` URL and verify `/api/hello` returns a JSON response.

The app service gets the scraper private `host:port` from Render and adds `http://` at runtime if needed.

### Production Passkeys

Production seeds only the real users unless `SeedTestUsers=true` is set:

```text
Basim:  basim-e537-dc50-3bb8
Avi:    avi-79fa-1d3a-3460
Suyash: suyash-1efa-61d5-4fb3
```

`SeedTestUsers=true` additionally seeds Alice, Bob, and Carol for mock-mode test runs. Local Docker validation sets this automatically when `USE_SCRAPER_MOCK_MODE=true`.
