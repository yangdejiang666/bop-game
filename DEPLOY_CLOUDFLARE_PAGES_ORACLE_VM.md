# Cloudflare Pages + Oracle VM Deployment

This repo is ready for the following split deployment:

- Frontend: Cloudflare Pages (`https://bop-game.pages.dev`)
- Backend API: Oracle Cloud Free VM
- WebSocket/game gateway scaffold: same Oracle VM
- Database: PostgreSQL on the same Oracle VM

## What this setup supports today

- Password registration and login
- Account/profile persistence
- Cloud save / progression sync
- Room creation / join / ready flow
- Matchmaking API flow

## Important limitation

`game-server/` is still a gateway scaffold and is not yet wired into authoritative real-time gameplay.
This deployment will fully open the account/backend chain, but it does not magically turn the project into a complete 10-player real-time production server yet.

## 1. Oracle VM

Recommended Oracle Always Free shape:

- Ubuntu 22.04
- 1 public IP
- open ports `80`, `443`

Install Docker on the VM:

```bash
sudo bash deploy/oracle-vm/bootstrap-ubuntu.sh
```

## 2. DNS

Point these records to the Oracle VM public IP:

- `api.bop-game.com`
- `ws.bop-game.com`

If you use another domain, replace these names everywhere below.

## 3. Backend env

On the VM:

```bash
cd /opt
git clone https://github.com/yangdejiang666/bop-game.git
cd bop-game/deploy/oracle-vm
cp .env.example .env
```

Edit `.env` and set at minimum:

- `POSTGRES_PASSWORD`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `CORS_ORIGIN`
- `API_DOMAIN`
- `WS_DOMAIN`
- `PUBLIC_GAME_WS_URL`

For the current Pages domain, use:

```env
CORS_ORIGIN=https://bop-game.pages.dev
API_DOMAIN=api.bop-game.com
WS_DOMAIN=ws.bop-game.com
PUBLIC_GAME_WS_URL=wss://ws.bop-game.com/ws
```

## 4. Start backend stack

```bash
docker compose build --pull
docker compose up -d
```

Check:

```bash
curl https://api.bop-game.com/healthz
```

Expected: JSON with `"ok": true`

## 5. Cloudflare Pages frontend env

Set these production environment variables in the Cloudflare Pages dashboard for the `bop-game` project:

```env
VITE_APP_ENV=production
VITE_API_BASE_URL=https://api.bop-game.com/api/v1
VITE_WS_BASE_URL=wss://ws.bop-game.com/ws
VITE_USE_BACKEND_MATCHING=true
```

Build settings:

- Build command: `npm run build`
- Build output directory: `dist`

## 6. Redeploy frontend

If `bop-game.pages.dev` is already connected to the GitHub repo, pushing the updated code to the production branch is enough.

If needed, rebuild manually in Pages after the env vars are set.

## 7. Smoke test

After both sides are live:

1. Open `https://bop-game.pages.dev`
2. Register a new account
3. Verify login works
4. Open settings -> developer toolbox
5. Confirm account count increases and the current account appears
6. Create / join a private room to confirm room API flow

## 8. Server updates

Later deploys on the Oracle VM:

```bash
cd /opt/bop-game/deploy/oracle-vm
bash redeploy.sh
```

