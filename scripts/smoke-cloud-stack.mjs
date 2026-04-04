import process from "node:process";

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return "";
  }

  const value = process.argv[index + 1];
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(name) {
  return process.argv.includes(name);
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function deriveApiBase(siteUrl) {
  const site = trimTrailingSlash(siteUrl);
  return site ? `${site}/api/v1` : "";
}

function deriveApiOrigin(apiBaseUrl) {
  const apiBase = trimTrailingSlash(apiBaseUrl);
  if (!apiBase) {
    return "";
  }

  return apiBase.replace(/\/api\/v1$/i, "");
}

function deriveGatewayProbeUrl(wsBaseUrl) {
  const wsBase = trimTrailingSlash(wsBaseUrl);
  if (!wsBase) {
    return "";
  }

  try {
    const parsed = new URL(wsBase);
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "/");
  } catch {
    return "";
  }
}

function shouldSkipGatewayProbe(siteUrl, wsBaseUrl) {
  const site = trimTrailingSlash(siteUrl);
  const wsBase = trimTrailingSlash(wsBaseUrl);

  if (!site || !wsBase) {
    return false;
  }

  try {
    const siteParsed = new URL(site);
    const wsParsed = new URL(wsBase);

    // In direct ECS IP mode the browser connects over same-origin HTTP -> ws,
    // while the game gateway itself stays behind the Caddy reverse proxy.
    // Probing the raw gateway socket from GitHub runners is not reliable there,
    // so the site/API checks are the meaningful health signal.
    return (
      siteParsed.protocol === "http:" &&
      wsParsed.protocol === "ws:" &&
      siteParsed.hostname === wsParsed.hostname
    );
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "bop-cloud-smoke-test/1.0",
      accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    },
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    json,
  };
}

function ensureOkPayload(result, label) {
  if (!result.ok) {
    throw new Error(`${label} returned HTTP ${result.status}.`);
  }

  if (!result.json || result.json.ok !== true) {
    throw new Error(`${label} did not return an ok=true JSON payload.`);
  }
}

async function runCheck(label, url, validator) {
  if (!url) {
    return {
      label,
      url: "(skipped)",
      status: "skipped",
      message: "No URL provided.",
    };
  }

  try {
    const result = await fetchJson(url);
    validator(result);
    return {
      label,
      url,
      status: "passed",
      message: result.json?.service
        ? `service=${result.json.service}`
        : `HTTP ${result.status}`,
    };
  } catch (error) {
    return {
      label,
      url,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const siteUrl =
  trimTrailingSlash(readArg("--site")) ||
  trimTrailingSlash(process.env.SMOKE_SITE_URL);
const apiBaseUrl =
  trimTrailingSlash(readArg("--api-base")) ||
  trimTrailingSlash(process.env.SMOKE_API_BASE_URL) ||
  deriveApiBase(siteUrl);
const apiOrigin =
  trimTrailingSlash(readArg("--api-origin")) ||
  trimTrailingSlash(process.env.SMOKE_API_ORIGIN) ||
  deriveApiOrigin(apiBaseUrl);
const wsBaseUrl =
  trimTrailingSlash(readArg("--ws-base")) ||
  trimTrailingSlash(process.env.SMOKE_WS_BASE_URL);
const gatewayProbeUrl =
  trimTrailingSlash(readArg("--gateway-probe")) ||
  trimTrailingSlash(process.env.SMOKE_GATEWAY_PROBE_URL) ||
  deriveGatewayProbeUrl(wsBaseUrl);
const expectPlatform = !readFlag("--skip-platform");
const skipSiteHealth = readFlag("--skip-site-health");
const skipGatewayProbe =
  readFlag("--skip-gateway-probe") ||
  shouldSkipGatewayProbe(siteUrl, wsBaseUrl);

if (!siteUrl && !apiBaseUrl) {
  console.error(
    "Usage: node scripts/smoke-cloud-stack.mjs --site https://bop-game.pages.dev [--api-base https://api.bop-game.xyz/api/v1] [--ws-base wss://ws.bop-game.xyz/ws]",
  );
  process.exit(1);
}

const checks = [
  runCheck("Site Root", siteUrl, (result) => {
    if (!result.ok) {
      throw new Error(`Site root returned HTTP ${result.status}.`);
    }
  }),
  runCheck(
    "Site Healthz",
    skipSiteHealth || !siteUrl ? "" : `${siteUrl}/healthz`,
    (result) => ensureOkPayload(result, "Site healthz"),
  ),
  runCheck(
    "Site Readyz",
    skipSiteHealth || !siteUrl ? "" : `${siteUrl}/readyz`,
    (result) => ensureOkPayload(result, "Site readyz"),
  ),
  runCheck(
    "API Healthz",
    apiOrigin ? `${apiOrigin}/healthz` : "",
    (result) => ensureOkPayload(result, "API healthz"),
  ),
  runCheck(
    "API Readyz",
    apiOrigin ? `${apiOrigin}/readyz` : "",
    (result) => ensureOkPayload(result, "API readyz"),
  ),
  runCheck("API Root", apiBaseUrl, (result) => ensureOkPayload(result, "API root")),
  runCheck(
    "Platform Config",
    expectPlatform && apiBaseUrl ? `${apiBaseUrl}/platform/config` : "",
    (result) => {
      ensureOkPayload(result, "Platform config");
      if (
        !result.json?.data ||
        typeof result.json.data !== "object" ||
        !Array.isArray(result.json.data.providers)
      ) {
        throw new Error("Platform config payload is missing the providers list.");
      }
    },
  ),
  runCheck("Gateway Probe", gatewayProbeUrl, (result) => {
    ensureOkPayload(result, "Gateway probe");
  }),
];

if (skipGatewayProbe) {
  checks[checks.length - 1] = runCheck("Gateway Probe", "", () => {});
}

const results = await Promise.all(checks);
const failed = results.filter((item) => item.status === "failed");

for (const result of results) {
  const badge =
    result.status === "passed"
      ? "[PASS]"
      : result.status === "failed"
        ? "[FAIL]"
        : "[SKIP]";
  console.log(`${badge} ${result.label}`);
  console.log(`  URL: ${result.url}`);
  console.log(`  ${result.message}`);
}

if (failed.length > 0) {
  console.error("");
  console.error(`Smoke test failed: ${failed.length} check(s) did not pass.`);
  process.exit(1);
}

console.log("");
console.log("Smoke test passed.");
