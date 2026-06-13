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

Create a Docker web service from this repository. The default Docker target builds the app runtime image.
