# Cloudflare Pages + Oracle VM Deployment

This repo is ready for the following split deployment:

- Frontend: Cloudflare Pages (`https://bop-game.pages.dev`)
- Backend API: Oracle Cloud Free VM
- WebSocket/game gateway scaffold: same Oracle VM
- Database: PostgreSQL on the same Oracle VM

This is the deployment path to use when you want the project to behave like a real product instead of only a Pages demo.  
Right now it is also the only path that can carry the current `Stripe / Supabase / Resend / Clerk / PostHog / Sentry / Upstash / Pinecone` integration layer.

## What this setup supports today

- Password registration and login
- Clerk platform login
- Password reset by email
- Resend inbound email webhook reception
- Stripe checkout + webhook fulfillment
- Supabase avatar upload
- PostHog + Sentry telemetry
- Upstash rate limits / ephemeral challenges
- Pinecone semantic search endpoint
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

If you want a ready-to-edit local baseline first, generate it from the repo root:

```bash
npm run deploy:env:split
```

That command creates:

- `./.env.production`
- `./deploy/oracle-vm/.env`

It also generates fresh values for `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`, while leaving optional provider integrations disabled until you fill in live keys.

If you want the full provider stack, also fill:

- `STRIPE_*`
- `SUPABASE_*`
- `RESEND_*`
- `CLERK_*`
- `POSTHOG_*`
- `SENTRY_*`
- `UPSTASH_*`
- `PINECONE_*`

For the current Pages domain, use:

```env
CORS_ORIGIN=https://bop-game.pages.dev
API_DOMAIN=api.bop-game.com
WS_DOMAIN=ws.bop-game.com
PUBLIC_GAME_WS_URL=wss://ws.bop-game.com/ws
PUBLIC_SITE_URL=https://bop-game.pages.dev
```

The full template now lives in:

- [deploy/oracle-vm/.env.example](/d:/all/bop/deploy/oracle-vm/.env.example)

Provider notes:

- `Stripe`: point your webhook to `https://api.bop-game.com/api/v1/platform/commerce/webhooks/stripe`
- `Supabase`: create the public bucket from `SUPABASE_AVATAR_BUCKET`
- `Resend`: `RESEND_FROM_EMAIL` must be a verified sender identity
- `Resend`: set `RESEND_WEBHOOK_SECRET` and point the webhook to `https://api.bop-game.com/api/v1/platform/communications/webhooks/resend` if you want inbound email reception
- `Clerk`: `CLERK_AUTHORIZED_PARTIES` must include `https://bop-game.pages.dev`
- `Upstash`: the REST URL + token are required for rate limit persistence
- `Pinecone`: use the index host, not only the project name

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
VITE_ENABLE_LOCAL_AUTH_BYPASS=false
```

If you want the frontend to expose the full platform layer, also mirror the browser-facing provider flags from:

- [.env.production.example](/d:/all/bop/.env.production.example)

Typical additions:

```env
VITE_CLERK_ENABLED=true
VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx
VITE_STRIPE_ENABLED=true
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_xxx
VITE_SUPABASE_ENABLED=true
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
VITE_POSTHOG_ENABLED=true
VITE_POSTHOG_API_KEY=phc_xxx
VITE_SENTRY_ENABLED=true
VITE_SENTRY_DSN=https://xxx.ingest.sentry.io/xxx
```

Build settings:

- Build command: `npm run build`
- Build output directory: `dist`

## 6. Redeploy frontend

If `bop-game.pages.dev` is already connected to the GitHub repo, pushing the updated code to the production branch is enough.

If needed, rebuild manually in Pages after the env vars are set.

## 6.1 GitHub Actions automation

This repo now includes:

- [.github/workflows/ci.yml](/d:/all/bop/.github/workflows/ci.yml)
- [.github/workflows/deploy-pages.yml](/d:/all/bop/.github/workflows/deploy-pages.yml)
- [.github/workflows/deploy-oracle-vm.yml](/d:/all/bop/.github/workflows/deploy-oracle-vm.yml)

Recommended GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ORACLE_VM_HOST`
- `ORACLE_VM_USER`
- `ORACLE_VM_SSH_KEY`

Recommended GitHub variables:

- `CLOUDFLARE_PAGES_PROJECT=bop-game`
- `CLOUDFLARE_PAGES_URL=https://bop-game.pages.dev`
- `CLOUDFLARE_PAGES_DEPLOY_ENABLED=true`
- `ORACLE_VM_APP_DIR=/opt/bop-game`
- `ORACLE_API_BASE_URL=https://api.bop-game.com/api/v1`
- `ORACLE_WS_BASE_URL=wss://ws.bop-game.com/ws`

Useful local preflight commands:

```bash
npm run deploy:check:split
npm run smoke:cloud -- --site https://bop-game.pages.dev --api-base https://api.bop-game.com/api/v1 --ws-base wss://ws.bop-game.com/ws
```

## 7. Smoke test

After both sides are live:

1. Open `https://bop-game.pages.dev`
2. Register a new account
3. Verify password login works
4. If Clerk is enabled, verify Clerk login returns to the same account layer
5. Open settings -> developer toolbox
6. Confirm account count increases and the current account appears
7. Create / join a private room to confirm room API flow
8. If Stripe is enabled, create a test checkout and confirm the callback lands on `?checkout=success`
9. If Resend is enabled, request a password reset and verify the email is received
10. If inbound email is enabled, send a test email into the Resend domain and confirm the webhook hits `POST /api/v1/platform/communications/webhooks/resend`

You can also run the repo smoke script from any machine that can reach the cloud endpoints:

```bash
npm run smoke:cloud -- --site https://bop-game.pages.dev --api-base https://api.bop-game.com/api/v1 --ws-base wss://ws.bop-game.com/ws
```

That script checks:

- site root
- Pages `healthz` / `readyz`
- API `healthz` / `readyz`
- API root
- `platform/config`
- gateway root probe derived from `wss://.../ws`

Before you publish, you can also validate env completeness locally:

```bash
npm run deploy:check:split
```

## 8. Server updates

Later deploys on the Oracle VM:

```bash
cd /opt/bop-game/deploy/oracle-vm
bash redeploy.sh
```

After every redeploy, rerun the smoke script before you open the build to players.
