# Local Dev

## One-command stack

Use the root scripts to build and start the local frontend + API stack:

```powershell
npm run local:start
```

Fast restart without rebuilding:

```powershell
npm run local:start:fast
```

Stop both processes:

```powershell
npm run local:stop
```

## What it starts

- Frontend static site: `http://127.0.0.1:4180`
- API server: `http://127.0.0.1:8788`
- Game gateway: `http://127.0.0.1:8899`
- Local WebSocket base: `ws://127.0.0.1:8899/ws`
- API health check: `http://127.0.0.1:8788/healthz`
- Game gateway probe: `http://127.0.0.1:8899/`

The start script intentionally runs the compiled API (`api-server/dist/index.js`) instead of `tsx watch`, because the current local environment has a `spawn EPERM` issue with the watch path.
If the frontend rebuild hits the known local Vite `spawn EPERM` problem but a previous `dist/` already exists, the script will reuse that last successful frontend build so the stack can still start.

## Local overrides

Optional frontend overrides:

- [`/.env.local.example`](./.env.local.example)

Optional API overrides:

- [`/api-server/.env.local.example`](./api-server/.env.local.example)

Create the matching `.env.local` file only if you need to override ports, JWT secrets, or the database URL. The start script reads `api-server/.env.local` directly and also passes `VITE_API_BASE_URL` into the frontend build.

## Logs and runtime metadata

Runtime artifacts are written to `.tmp_local-stack/`:

- `api-server.log`
- `api-server.error.log`
- `game-server.log`
- `game-server.error.log`
- `web.log`
- `web.error.log`
- `local-stack.json`
