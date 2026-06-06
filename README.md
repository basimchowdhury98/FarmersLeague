# FarmersLeague

Minimal shell for a World Cup friends league app.

## Stack

- .NET API serving the production Angular app
- Angular web UI
- API-Football-compatible mock API for local testing
- Cypress e2e test
- Docker/Render-ready app image

## Local Docker Run

```sh
make run
```

Open `http://localhost:8080`.

## Cypress

To start the app with the mock API and run all Cypress tests:

```sh
make val
```

## Services

- App: `http://localhost:8080`
- Mock API: `http://localhost:5081/v3/fixtures?league=1&season=2026`

## Render

Create a Docker web service from this repository. The default Docker target builds the app runtime image.
