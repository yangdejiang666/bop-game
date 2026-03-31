import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return fallback;
  }

  return value.trim();
}

function normalizeBool(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function mergeEnv(filePaths) {
  const merged = {};
  for (const filePath of filePaths) {
    Object.assign(merged, parseEnvFile(filePath));
  }
  Object.assign(merged, process.env);
  return merged;
}

function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value) {
  if (!isPresent(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isWsUrl(value) {
  if (!isPresent(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

function pushResult(results, status, label, message) {
  results.push({ status, label, message });
}

function requireKeys(results, scope, env, keys) {
  const missing = keys.filter((key) => !isPresent(env[key]));
  if (missing.length > 0) {
    pushResult(
      results,
      "fail",
      `${scope} required keys`,
      `Missing: ${missing.join(", ")}`,
    );
    return false;
  }

  pushResult(results, "pass", `${scope} required keys`, "All required keys are present.");
  return true;
}

function requireUrl(results, scope, env, key, validator, expectedLabel) {
  if (!isPresent(env[key])) {
    pushResult(results, "fail", `${scope} ${key}`, "Value is missing.");
    return;
  }

  if (!validator(env[key])) {
    pushResult(
      results,
      "fail",
      `${scope} ${key}`,
      `Expected a valid ${expectedLabel} URL.`,
    );
    return;
  }

  pushResult(results, "pass", `${scope} ${key}`, env[key]);
}

function requireIfEnabled(results, scope, env, enabledKey, keys) {
  if (!normalizeBool(env[enabledKey])) {
    pushResult(
      results,
      "skip",
      `${scope} ${enabledKey}`,
      "Feature is disabled.",
    );
    return;
  }

  requireKeys(results, `${scope} (${enabledKey}=true)`, env, keys);
}

function requireProvider(results, scope, providerName, env, providerKey, expectedValue, keys) {
  if (String(env[providerKey] ?? "").trim() !== expectedValue) {
    pushResult(
      results,
      "skip",
      `${scope} ${providerKey}`,
      `${providerName} is not selected.`,
    );
    return;
  }

  requireKeys(results, `${scope} ${providerName}`, env, keys);
}

function resolveFile(...segments) {
  return path.join(rootDir, ...segments);
}

const mode = readArg("--mode", "split-stack");
const frontendEnvFile =
  readArg("--frontend-env") || resolveFile(".env.production");
const apiEnvFile =
  readArg("--api-env") || resolveFile("api-server", ".env.production");
const oracleEnvFile =
  readArg("--oracle-env") || resolveFile("deploy", "oracle-vm", ".env");

const frontendEnv = mergeEnv([frontendEnvFile]);
const apiEnv = mergeEnv([apiEnvFile]);
const oracleEnv = mergeEnv([oracleEnvFile]);

const results = [];

pushResult(
  results,
  fs.existsSync(frontendEnvFile) ? "pass" : "warn",
  "Frontend env file",
  fs.existsSync(frontendEnvFile)
    ? frontendEnvFile
    : `${frontendEnvFile} not found, using process env only.`,
);

if (mode === "split-stack") {
  pushResult(
    results,
    fs.existsSync(oracleEnvFile) ? "pass" : "warn",
    "Oracle env file",
    fs.existsSync(oracleEnvFile)
      ? oracleEnvFile
      : `${oracleEnvFile} not found, using process env only.`,
  );
}

requireKeys(results, "frontend", frontendEnv, [
  "VITE_APP_ENV",
  "VITE_USE_BACKEND_MATCHING",
]);

if (mode === "split-stack") {
  requireKeys(results, "frontend split-stack", frontendEnv, [
    "VITE_API_BASE_URL",
    "VITE_WS_BASE_URL",
  ]);
  requireUrl(
    results,
    "frontend",
    frontendEnv,
    "VITE_API_BASE_URL",
    isHttpUrl,
    "http/https",
  );
  requireUrl(
    results,
    "frontend",
    frontendEnv,
    "VITE_WS_BASE_URL",
    isWsUrl,
    "ws/wss",
  );

  requireKeys(results, "oracle", oracleEnv, [
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "API_HOST",
    "API_PORT",
    "GAME_HOST",
    "GAME_PORT",
    "GAME_WS_PATH",
    "CORS_ORIGIN",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "JWT_ISSUER",
    "JWT_AUDIENCE",
    "PUBLIC_GAME_WS_URL",
    "PUBLIC_SITE_URL",
    "API_DOMAIN",
    "WS_DOMAIN",
    "SITE_ORIGIN",
  ]);
  requireUrl(
    results,
    "oracle",
    oracleEnv,
    "PUBLIC_SITE_URL",
    isHttpUrl,
    "http/https",
  );
  requireUrl(
    results,
    "oracle",
    oracleEnv,
    "SITE_ORIGIN",
    isHttpUrl,
    "http/https",
  );
  requireUrl(
    results,
    "oracle",
    oracleEnv,
    "PUBLIC_GAME_WS_URL",
    isWsUrl,
    "ws/wss",
  );
} else if (mode === "pages-d1") {
  pushResult(
    results,
    "warn",
    "Pages-only boundary",
    "Pages + D1 currently covers account/hall flows, not the full Stripe/Supabase/Resend/Clerk/Pinecone product chain.",
  );

  if (
    normalizeBool(frontendEnv.VITE_STRIPE_ENABLED) ||
    normalizeBool(frontendEnv.VITE_CLERK_ENABLED) ||
    normalizeBool(frontendEnv.VITE_SUPABASE_ENABLED)
  ) {
    pushResult(
      results,
      "warn",
      "Pages-only platform flags",
      "Frontend platform flags are enabled, but Pages-only mode still lacks the corresponding server endpoints.",
    );
  }
}

requireIfEnabled(results, "frontend", frontendEnv, "VITE_CLERK_ENABLED", [
  "VITE_CLERK_PUBLISHABLE_KEY",
]);
requireIfEnabled(results, "frontend", frontendEnv, "VITE_STRIPE_ENABLED", [
  "VITE_STRIPE_PUBLISHABLE_KEY",
]);
requireIfEnabled(results, "frontend", frontendEnv, "VITE_SUPABASE_ENABLED", [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
]);
requireIfEnabled(results, "frontend", frontendEnv, "VITE_POSTHOG_ENABLED", [
  "VITE_POSTHOG_API_KEY",
]);
requireIfEnabled(results, "frontend", frontendEnv, "VITE_SENTRY_ENABLED", [
  "VITE_SENTRY_DSN",
]);

if (mode === "split-stack") {
  requireIfEnabled(results, "oracle", oracleEnv, "STRIPE_ENABLED", [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]);
  requireIfEnabled(results, "oracle", oracleEnv, "SUPABASE_ENABLED", [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  requireProvider(results, "oracle", "Resend email", oracleEnv, "EMAIL_PROVIDER", "resend", [
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
  ]);
  requireIfEnabled(results, "oracle", oracleEnv, "RESEND_ENABLED", [
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
  ]);
  if (normalizeBool(oracleEnv.RESEND_ENABLED)) {
    pushResult(
      results,
      isPresent(oracleEnv.RESEND_WEBHOOK_SECRET) ? "pass" : "warn",
      "oracle RESEND_WEBHOOK_SECRET",
      isPresent(oracleEnv.RESEND_WEBHOOK_SECRET)
        ? "Inbound email webhook signing secret is present."
        : "Set RESEND_WEBHOOK_SECRET to enable inbound email reception via the Resend webhook endpoint.",
    );
  }
  requireProvider(results, "oracle", "Aliyun SMS", oracleEnv, "SMS_PROVIDER", "aliyun", [
    "ALIYUN_SMS_ACCESS_KEY_ID",
    "ALIYUN_SMS_ACCESS_KEY_SECRET",
    "ALIYUN_SMS_SIGN_NAME",
    "ALIYUN_SMS_TEMPLATE_LOGIN",
  ]);
  if (String(oracleEnv.SMS_PROVIDER ?? "").trim() === "aliyun") {
    const recommended = [
      "ALIYUN_SMS_TEMPLATE_REGISTER",
      "ALIYUN_SMS_TEMPLATE_RESET_PASSWORD",
      "ALIYUN_SMS_TEMPLATE_BIND_MOBILE",
    ].filter((key) => !isPresent(oracleEnv[key]));
    pushResult(
      results,
      recommended.length === 0 ? "pass" : "warn",
      "oracle Aliyun SMS optional templates",
      recommended.length === 0
        ? "Register/reset/bind templates are all present."
        : `Missing optional but recommended template codes: ${recommended.join(", ")}`,
    );
  }
  requireIfEnabled(results, "oracle", oracleEnv, "CLERK_ENABLED", [
    "CLERK_PUBLISHABLE_KEY",
  ]);
  if (normalizeBool(oracleEnv.CLERK_ENABLED)) {
    const hasServerVerifier =
      isPresent(oracleEnv.CLERK_JWT_KEY) || isPresent(oracleEnv.CLERK_SECRET_KEY);
    pushResult(
      results,
      hasServerVerifier ? "pass" : "fail",
      "oracle Clerk server verifier",
      hasServerVerifier
        ? "CLERK_JWT_KEY or CLERK_SECRET_KEY is present."
        : "Set CLERK_JWT_KEY or CLERK_SECRET_KEY.",
    );
  }
  requireIfEnabled(results, "oracle", oracleEnv, "POSTHOG_ENABLED", [
    "POSTHOG_API_KEY",
  ]);
  requireIfEnabled(results, "oracle", oracleEnv, "SENTRY_ENABLED", [
    "SENTRY_DSN",
  ]);
  requireIfEnabled(results, "oracle", oracleEnv, "UPSTASH_ENABLED", [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]);
  requireIfEnabled(results, "oracle", oracleEnv, "PINECONE_ENABLED", [
    "PINECONE_API_KEY",
    "PINECONE_INDEX_HOST",
  ]);
}

const failed = results.filter((item) => item.status === "fail");

for (const result of results) {
  const badge =
    result.status === "pass"
      ? "[PASS]"
      : result.status === "fail"
        ? "[FAIL]"
        : result.status === "warn"
          ? "[WARN]"
          : "[SKIP]";
  console.log(`${badge} ${result.label}`);
  console.log(`  ${result.message}`);
}

console.log("");
if (failed.length > 0) {
  console.error(
    `Deployment readiness failed for mode=${mode}. ${failed.length} check(s) need attention.`,
  );
  process.exit(1);
}

console.log(`Deployment readiness passed for mode=${mode}.`);
