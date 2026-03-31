import { randomBytes } from "node:crypto";
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

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveFromRoot(...segments) {
  return path.join(rootDir, ...segments);
}

function requireOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL: ${value}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must start with http:// or https://: ${value}`);
  }

  return parsed.origin;
}

function normalizeDomain(value, label) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`);
  }

  if (trimmed.includes("://")) {
    return new URL(trimmed).host;
  }

  return trimmed.replace(/^\/+|\/+$/g, "");
}

function normalizePathSegment(value, fallback = "/ws") {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function randomToken(bytes) {
  return randomBytes(bytes).toString("base64url");
}

function uniqueCsv(values) {
  return [...new Set(values.filter(Boolean))].join(",");
}

function updateEnvTemplate(templateText, overrides) {
  const lines = templateText.split(/\r?\n/);
  const seen = new Set();

  const updated = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=.*$/.exec(line);
    if (!match) {
      return line;
    }

    const key = match[1];
    if (!(key in overrides)) {
      return line;
    }

    seen.add(key);
    return `${key}=${overrides[key]}`;
  });

  const missingKeys = Object.keys(overrides).filter((key) => !seen.has(key));
  if (missingKeys.length > 0) {
    if (updated.length > 0 && updated.at(-1) !== "") {
      updated.push("");
    }
    for (const key of missingKeys) {
      updated.push(`${key}=${overrides[key]}`);
    }
  }

  return `${updated.join("\n")}\n`;
}

function writeFileFromTemplate(templateFile, outputFile, overrides, force) {
  if (fs.existsSync(outputFile) && !force) {
    throw new Error(
      `${path.relative(rootDir, outputFile)} already exists. Re-run with --force to replace it.`,
    );
  }

  const templateText = fs.readFileSync(templateFile, "utf8");
  const nextText = updateEnvTemplate(templateText, overrides);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, nextText, "utf8");
}

const siteUrl = requireOrigin(
  readArg("--site-url", "https://bop-game.pages.dev"),
  "--site-url",
);
const extraSiteOrigin = readArg("--extra-site-origin", "https://bop-game.com").trim();
const extraOrigin = extraSiteOrigin ? requireOrigin(extraSiteOrigin, "--extra-site-origin") : "";
const apiDomain = normalizeDomain(readArg("--api-domain", "api.bop-game.com"), "--api-domain");
const wsDomain = normalizeDomain(readArg("--ws-domain", "ws.bop-game.com"), "--ws-domain");
const gameWsPath = normalizePathSegment(readArg("--game-ws-path", "/ws"));
const corsOrigins = uniqueCsv([siteUrl, extraOrigin]);
const frontendOut = resolveFromRoot(readArg("--frontend-out", ".env.production"));
const oracleOut = resolveFromRoot(
  readArg("--oracle-out", path.join("deploy", "oracle-vm", ".env")),
);
const force = hasFlag("--force");

const postgresDb = readArg("--postgres-db", "bop");
const postgresUser = readArg("--postgres-user", "bop");
const postgresPassword = readArg("--postgres-password", randomToken(18));
const jwtAccessSecret = readArg("--jwt-access-secret", randomToken(48));
const jwtRefreshSecret = readArg("--jwt-refresh-secret", randomToken(48));
const apiPort = readArg("--api-port", "8788");
const gamePort = readArg("--game-port", "8899");
const publicApiPort = readArg("--public-api-port", apiPort);
const publicGamePort = readArg("--public-game-port", gamePort);
const apiBaseUrl = `https://${apiDomain}/api/v1`;
const wsBaseUrl = `wss://${wsDomain}${gameWsPath}`;

writeFileFromTemplate(
  resolveFromRoot(".env.production.example"),
  frontendOut,
  {
    VITE_APP_ENV: "production",
    VITE_API_BASE_URL: apiBaseUrl,
    VITE_WS_BASE_URL: wsBaseUrl,
    VITE_USE_BACKEND_MATCHING: "true",
    VITE_ENABLE_LOCAL_AUTH_BYPASS: "false",
    VITE_CLERK_AFTER_SIGN_IN_URL: siteUrl,
    VITE_CLERK_AFTER_SIGN_UP_URL: siteUrl,
    VITE_SENTRY_ENVIRONMENT: "production",
  },
  force,
);

writeFileFromTemplate(
  resolveFromRoot("deploy", "oracle-vm", ".env.example"),
  oracleOut,
  {
    POSTGRES_DB: postgresDb,
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    API_HOST: "0.0.0.0",
    API_PORT: apiPort,
    PUBLIC_API_PORT: publicApiPort,
    GAME_HOST: "0.0.0.0",
    GAME_PORT: gamePort,
    PUBLIC_GAME_PORT: publicGamePort,
    GAME_WS_PATH: gameWsPath,
    CORS_ORIGIN: corsOrigins,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    JWT_ISSUER: "bop-api",
    JWT_AUDIENCE: "bop-client",
    PUBLIC_GAME_WS_URL: wsBaseUrl,
    PUBLIC_SITE_URL: siteUrl,
    LOG_LEVEL: "info",
    API_DOMAIN: apiDomain,
    WS_DOMAIN: wsDomain,
    SITE_ORIGIN: siteUrl,
    STRIPE_SUCCESS_URL: `${siteUrl}/?checkout=success`,
    STRIPE_CANCEL_URL: `${siteUrl}/?checkout=cancelled`,
    CLERK_AFTER_SIGN_IN_URL: siteUrl,
    CLERK_AFTER_SIGN_UP_URL: siteUrl,
    CLERK_AUTHORIZED_PARTIES: corsOrigins,
    SENTRY_ENVIRONMENT: "production",
  },
  force,
);

console.log(`Wrote ${path.relative(rootDir, frontendOut)}`);
console.log(`Wrote ${path.relative(rootDir, oracleOut)}`);
console.log("Generated fresh secrets for POSTGRES_PASSWORD, JWT_ACCESS_SECRET, and JWT_REFRESH_SECRET.");
console.log("Provider integrations remain disabled until you fill in their live keys.");
