# Platform Integrations

This project now has a shared platform layer for `Stripe`, `Supabase`, `Resend`, `Aliyun SMS`, `Clerk`, `PostHog`, `Sentry`, `Upstash`, and `Pinecone`.

## What is wired

- `Stripe`
  - Server endpoint: `POST /api/v1/platform/commerce/checkout`
  - Webhook endpoint: `POST /api/v1/platform/commerce/webhooks/stripe`
  - Supports the built-in product keys `coins_1200`, `founder_pack`, and `season_pass`
  - Completed checkouts grant coins and can send a receipt email
- `Supabase`
  - Server endpoint: `POST /api/v1/platform/storage/avatar/upload`
  - Frontend avatar `data:` uploads are pushed into the configured storage bucket
- `Resend`
  - Password reset emails are sent from `/api/v1/auth/password/request-reset`
  - Email verification codes can be sent from `POST /api/v1/auth/email/send`
  - Email binding is completed through `POST /api/v1/auth/bind/email`
  - Purchase receipts are sent after successful Stripe fulfillment when an email is available
  - Inbound emails can be received through `POST /api/v1/platform/communications/webhooks/resend`
- `Aliyun SMS`
  - SMS verification codes can be sent from `POST /api/v1/auth/sms/send`
  - SMS login is completed through `POST /api/v1/auth/login` with `method: "sms"`
  - Mobile binding is completed through `POST /api/v1/auth/bind/mobile`
  - Password reset can be requested over SMS from `POST /api/v1/auth/password/request-reset`
- `Clerk`
  - Frontend opens Clerk sign-in
  - Backend verifies Clerk session tokens and exchanges them for the project's own auth tokens
- `PostHog`
  - Browser events and backend events are captured through the shared telemetry helpers
- `Sentry`
  - Browser exceptions and API unhandled errors are captured
- `Upstash`
  - Login, register, and checkout routes are rate limited
  - Password reset challenges and Stripe fulfillment dedupe can use Upstash as the ephemeral store
- `Pinecone`
  - Server endpoint: `POST /api/v1/platform/ai/search`
  - Frontend network client is ready to query the configured namespace

## Main files

- Frontend bootstrap: `src/main.ts`
- Frontend config: `src/platform/config.ts`
- Frontend telemetry: `src/platform/telemetry.ts`
- Frontend Clerk bridge: `src/platform/clerk.ts`
- Frontend platform client: `src/network/platformService.ts`
- API config: `api-server/src/lib/config.ts`
- API platform service: `api-server/src/services/platformService.ts`
- API platform routes: `api-server/src/modules/platform.ts`
- API auth routes: `api-server/src/modules/auth.ts`

## Required setup

1. Fill the frontend env file from `.env.local.example` or `.env.production.example`.
2. Fill the API env file from `api-server/.env.local.example` or `api-server/.env.production.example`.
3. Restart the frontend and API server after changing env values.

## Provider notes

### Stripe

- Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the relevant `STRIPE_PRICE_ID_*` values on the API server.
- Set `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` back to this app. The frontend now consumes `?checkout=success` and `?checkout=cancelled`.
- The API server script now builds `shared-protocol` automatically before `check`, `build`, and `dev`, so new protocol fields stay in sync.

### Supabase

- Create a public bucket matching `SUPABASE_AVATAR_BUCKET` such as `avatars`.
- The API server needs the service-role key because avatar uploads are performed server-side.
- The frontend anon key is still useful if you later add direct client reads or signed URL flows.

### Resend

- `EMAIL_PROVIDER=resend`, `RESEND_ENABLED=true`, and `RESEND_FROM_EMAIL` must be set together.
- `RESEND_FROM_EMAIL` must use a sender identity that is valid in your Resend account.
- `RESEND_WEBHOOK_SECRET` enables signed inbound email webhooks from Resend.
- Point the Resend webhook endpoint to `POST /api/v1/platform/communications/webhooks/resend` and subscribe to at least `email.received`.
- If you leave `EMAIL_PROVIDER=disabled`, email verification and password reset cannot use a real mailbox transport.
- If you keep `EMAIL_PROVIDER=local`, auth flows still work locally, but codes are only captured into the verification challenge debug payload for smoke tests.

### Aliyun SMS

- `SMS_PROVIDER=aliyun`, `ALIYUN_SMS_ENABLED=true`, `ALIYUN_SMS_SIGN_NAME`, and `ALIYUN_SMS_TEMPLATE_LOGIN` must be set together.
- `ALIYUN_SMS_TEMPLATE_REGISTER`, `ALIYUN_SMS_TEMPLATE_RESET_PASSWORD`, and `ALIYUN_SMS_TEMPLATE_BIND_MOBILE` are strongly recommended so each auth flow has a dedicated approved template.
- If you leave `SMS_PROVIDER=disabled`, the app cannot deliver real SMS verification.
- If you keep `SMS_PROVIDER=local`, SMS auth flows still work locally, but codes are only captured into the database debug payload instead of being delivered to a handset.

### Clerk

- The frontend must have `VITE_CLERK_PUBLISHABLE_KEY` or the Clerk button will stay hidden.
- The API server must have either `CLERK_JWT_KEY` or `CLERK_SECRET_KEY`.
- `CLERK_AUTHORIZED_PARTIES` must include the exact browser origin, for example `http://127.0.0.1:4180` locally or your production site origin.

### PostHog and Sentry

- Browser telemetry uses the root `VITE_*` variables.
- Server telemetry uses the API env file.
- You can use the same Sentry project for browser and server, but separate DSNs are usually easier to reason about.

### Upstash

- Upstash is optional but recommended in production.
- Window values like `10 m`, `30 m`, and `5 m` match the current rate-limit config parser usage.
- When Upstash is disabled, the API falls back to in-memory storage for password reset challenges and Stripe dedupe.

### Pinecone

- Use the index host from the Pinecone console for `PINECONE_INDEX_HOST`.
- `PINECONE_NAMESPACE` defaults to `bop-guide`.
- The frontend client is ready, but you still need to connect the query to a UI surface if you want in-app knowledge search.

## Verification

Run these after env setup:

```bash
cd shared-protocol && npm run check
cd ../api-server && npm run check
cd .. && npm run build
npm run smoke:auth
```

If you want to validate the Stripe flow end-to-end, also point the Stripe webhook to:

```text
POST /api/v1/platform/commerce/webhooks/stripe
```

## Local auth bypass

- `VITE_ENABLE_LOCAL_AUTH_BYPASS=true` only affects password login in the browser.
- Keep it `false` whenever you are validating Clerk, Stripe, Supabase, Resend, Aliyun SMS, or any real backend-linked flow.
