import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const apiServerDir = path.join(rootDir, "api-server");
const gameServerDir = path.join(rootDir, "game-server");
const runtimeDir = path.join(rootDir, ".tmp_local-stack");
const metadataPath = path.join(runtimeDir, "local-stack.json");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const env = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
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
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function terminateProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

function findListeningPids(port) {
  if (!Number.isFinite(port) || port <= 0) {
    return [];
  }

  if (process.platform === "win32") {
    const result = spawnSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const output = result.stdout ?? "";
    const pidSet = new Set();
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes("LISTENING") || !line.includes(`:${port}`)) {
        continue;
      }

      const match = line.match(/\s+(\d+)\s*$/);
      if (match) {
        pidSet.add(Number(match[1]));
      }
    }
    return [...pidSet];
  }

  const result = spawnSync("lsof", ["-ti", `tcp:${port}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parsePortFromUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortToStopListening(port, timeoutMs = 6_000) {
  if (!Number.isFinite(port) || port <= 0) {
    return true;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (findListeningPids(port).length === 0) {
      return true;
    }
    await sleep(250);
  }

  return findListeningPids(port).length === 0;
}

async function stopPortListeners(port) {
  const pids = findListeningPids(port);
  const stopped = pids.filter((pid) => terminateProcess(pid));
  if (stopped.length > 0) {
    await waitForPortToStopListening(port);
  }
  return stopped;
}

async function probeJson(url, expectedService) {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.service === expectedService;
  } catch {
    return false;
  }
}

async function probeFrontend(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      return false;
    }

    const html = await response.text();
    return html.includes("<title>球球派对大厅</title>");
  } catch {
    return false;
  }
}

function addStoppedPid(stopped, label, pid) {
  const entry = `${label}:${pid}`;
  if (!stopped.includes(entry)) {
    stopped.push(entry);
  }
}

async function stopKnownService(stopped, label, port, probe) {
  if (!Number.isFinite(port) || port <= 0) {
    return;
  }

  if (!(await probe())) {
    return;
  }

  for (const pid of await stopPortListeners(port)) {
    addStoppedPid(stopped, label, pid);
  }
}

const rootEnv = {
  ...parseEnvFile(path.join(rootDir, ".env")),
  ...parseEnvFile(path.join(rootDir, ".env.local")),
};

const apiEnv = {
  ...parseEnvFile(path.join(apiServerDir, ".env")),
  ...parseEnvFile(path.join(apiServerDir, ".env.local")),
};

const gameEnv = {
  ...parseEnvFile(path.join(gameServerDir, ".env")),
  ...parseEnvFile(path.join(gameServerDir, ".env.local")),
};

const apiHost = apiEnv.API_HOST || "127.0.0.1";
const apiPort = Number(apiEnv.API_PORT || "8788");
const gameHost =
  gameEnv.GAME_HOST || rootEnv.LOCAL_GAME_HOST || "127.0.0.1";
const gamePort = Number(
  gameEnv.GAME_PORT || rootEnv.LOCAL_GAME_PORT || "8899",
);
const webHost = rootEnv.LOCAL_WEB_HOST || "127.0.0.1";
const webPort = Number(rootEnv.LOCAL_WEB_PORT || "4180");

const metadata = existsSync(metadataPath)
  ? JSON.parse(readFileSync(metadataPath, "utf8"))
  : null;
const stopped = [];

if (metadata && terminateProcess(metadata.apiPid)) {
  addStoppedPid(stopped, "api", metadata.apiPid);
}

if (metadata && terminateProcess(metadata.gamePid)) {
  addStoppedPid(stopped, "game", metadata.gamePid);
}

if (metadata && terminateProcess(metadata.webPid)) {
  addStoppedPid(stopped, "web", metadata.webPid);
}

const metadataApiPort = parsePortFromUrl(metadata?.healthUrl || metadata?.apiUrl);
const metadataGamePort = parsePortFromUrl(metadata?.gameUrl || metadata?.wsBaseUrl);
const metadataWebPort = parsePortFromUrl(metadata?.webUrl);

for (const pid of await stopPortListeners(metadataApiPort)) {
  addStoppedPid(stopped, "api", pid);
}

for (const pid of await stopPortListeners(metadataGamePort)) {
  addStoppedPid(stopped, "game", pid);
}

for (const pid of await stopPortListeners(metadataWebPort)) {
  addStoppedPid(stopped, "web", pid);
}

await stopKnownService(
  stopped,
  "api",
  apiPort,
  () => probeJson(`http://${apiHost}:${apiPort}/healthz`, "bop-api-server"),
);
await stopKnownService(
  stopped,
  "game",
  gamePort,
  () => probeJson(`http://${gameHost}:${gamePort}/`, "bop-game-server"),
);
await stopKnownService(
  stopped,
  "web",
  webPort,
  () => probeFrontend(`http://${webHost}:${webPort}`),
);

if (existsSync(metadataPath)) {
  rmSync(metadataPath, { force: true });
}

if (stopped.length === 0) {
  console.log("No known local stack service was running.");
} else {
  console.log(`Stopped ${stopped.join(", ")}`);
}
