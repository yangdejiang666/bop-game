import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const sharedProtocolDir = path.join(rootDir, "shared-protocol");
const apiServerDir = path.join(rootDir, "api-server");
const gameServerDir = path.join(rootDir, "game-server");
const runtimeDir = path.join(rootDir, ".tmp_local-stack");
const metadataPath = path.join(runtimeDir, "local-stack.json");
const npmCacheDir = path.join(rootDir, ".tmp_npm_cache");
const toolingEnv = {
  ...process.env,
  npm_config_cache: npmCacheDir,
};

const args = process.argv.slice(2);
const npmCommand = "npm";

function readFlag(name) {
  return args.includes(name);
}

function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    return fallback;
  }

  return next;
}

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

function executeCommand(command, commandArgs, cwd, env = toolingEnv) {
  const windowsCommand =
    process.platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : command;
  const windowsArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `${command} ${commandArgs.join(" ")}`]
      : commandArgs;

  const result = spawnSync(windowsCommand, windowsArgs, {
    cwd,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  return result;
}

function runCommand(command, commandArgs, cwd, env = toolingEnv) {
  const result = executeCommand(command, commandArgs, cwd, env);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureDependencies(directory, installArgs) {
  const nodeModulesDir = path.join(directory, "node_modules");
  if (existsSync(nodeModulesDir)) {
    return;
  }

  console.log(`Installing dependencies in ${path.basename(directory)}...`);
  runCommand(npmCommand, installArgs, directory);
}

function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    // These local services are direct detached Node children, so a plain kill
    // is more reliable than shelling out on locked-down Windows setups.
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw new Error(`Timed out waiting for ${url}`);
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
  let stopped = false;
  for (const pid of pids) {
    stopped = terminateProcessTree(pid) || stopped;
  }

  if (stopped) {
    await waitForPortToStopListening(port);
  }

  return stopped;
}

async function stopStaleHttpService(host, port, pathname, expectedService) {
  try {
    const response = await fetch(`http://${host}:${port}${pathname}`, {
      method: "GET",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    if (payload?.service !== expectedService) {
      return false;
    }
  } catch {
    return false;
  }

  return stopPortListeners(port);
}

mkdirSync(runtimeDir, { recursive: true });
mkdirSync(npmCacheDir, { recursive: true });

if (existsSync(metadataPath)) {
  const previousMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  terminateProcessTree(previousMetadata.apiPid);
  terminateProcessTree(previousMetadata.gamePid);
  terminateProcessTree(previousMetadata.webPid);
}

const rootEnvFile = {
  ...parseEnvFile(path.join(rootDir, ".env")),
  ...parseEnvFile(path.join(rootDir, ".env.local")),
};

const apiEnvFile = {
  ...parseEnvFile(path.join(apiServerDir, ".env")),
  ...parseEnvFile(path.join(apiServerDir, ".env.local")),
};

const gameEnvFile = {
  ...parseEnvFile(path.join(gameServerDir, ".env")),
  ...parseEnvFile(path.join(gameServerDir, ".env.local")),
};

const skipBuild = readFlag("--skip-build");
const apiHost = readArg("--api-host", apiEnvFile.API_HOST || "127.0.0.1");
const apiPort = Number(readArg("--api-port", apiEnvFile.API_PORT || "8788"));
const gameHost = readArg(
  "--game-host",
  gameEnvFile.GAME_HOST || rootEnvFile.LOCAL_GAME_HOST || "127.0.0.1",
);
const gamePort = Number(
  readArg(
    "--game-port",
    gameEnvFile.GAME_PORT || rootEnvFile.LOCAL_GAME_PORT || "8899",
  ),
);
const gameWsPath = readArg(
  "--game-ws-path",
  gameEnvFile.GAME_WS_PATH || rootEnvFile.LOCAL_GAME_WS_PATH || "/ws",
);
const webHost = readArg("--web-host", rootEnvFile.LOCAL_WEB_HOST || "127.0.0.1");
const webPort = Number(readArg("--web-port", rootEnvFile.LOCAL_WEB_PORT || "4180"));
const publicApiHost = apiHost === "0.0.0.0" ? "127.0.0.1" : apiHost;
const publicGameHost = gameHost === "0.0.0.0" ? "127.0.0.1" : gameHost;
const defaultApiBaseUrl = `http://${publicApiHost}:${apiPort}/api/v1`;
const defaultWsBaseUrl = `ws://${publicGameHost}:${gamePort}${gameWsPath}`;
const apiBaseUrl = readArg(
  "--api-base-url",
  rootEnvFile.VITE_API_BASE_URL || defaultApiBaseUrl,
);
const wsBaseUrl = readArg(
  "--ws-base-url",
  rootEnvFile.VITE_WS_BASE_URL || defaultWsBaseUrl,
);
const databaseUrl = readArg(
  "--database-url",
  apiEnvFile.DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@127.0.0.1:5432/bop",
);

const buildEnv = {
  ...toolingEnv,
  ...rootEnvFile,
  VITE_API_BASE_URL: apiBaseUrl,
  VITE_WS_BASE_URL: wsBaseUrl,
  VITE_USE_BACKEND_MATCHING:
    rootEnvFile.VITE_USE_BACKEND_MATCHING || "true",
};

const apiEnv = {
  ...process.env,
  ...apiEnvFile,
  NODE_ENV: apiEnvFile.NODE_ENV || "development",
  API_HOST: apiHost,
  API_PORT: String(apiPort),
  CORS_ORIGIN:
    apiEnvFile.CORS_ORIGIN || `http://${webHost}:${webPort}`,
  DATABASE_URL: databaseUrl,
  JWT_ACCESS_SECRET:
    apiEnvFile.JWT_ACCESS_SECRET || "dev-access-secret-change-me",
  JWT_REFRESH_SECRET:
    apiEnvFile.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me",
};

const gameEnv = {
  ...process.env,
  ...gameEnvFile,
  NODE_ENV: gameEnvFile.NODE_ENV || "development",
  GAME_HOST: gameHost,
  GAME_PORT: String(gamePort),
  GAME_WS_PATH: gameWsPath,
  CORS_ORIGIN:
    gameEnvFile.CORS_ORIGIN || apiEnv.CORS_ORIGIN || `http://${webHost}:${webPort}`,
  LOG_LEVEL: gameEnvFile.LOG_LEVEL || "info",
};

await stopStaleHttpService(publicApiHost, apiPort, "/healthz", "bop-api-server");
await stopStaleHttpService(publicGameHost, gamePort, "/", "bop-game-server");
await stopPortListeners(webPort);

if (!skipBuild) {
  ensureDependencies(rootDir, ["ci"]);
  ensureDependencies(sharedProtocolDir, [
    "install",
    "--ignore-scripts",
    "--package-lock=false",
  ]);
  ensureDependencies(apiServerDir, ["ci"]);
  ensureDependencies(gameServerDir, [
    "install",
    "--ignore-scripts",
    "--package-lock=false",
  ]);

  console.log("Building shared protocol...");
  runCommand(npmCommand, ["run", "build"], sharedProtocolDir);

  console.log("Building API server...");
  runCommand(npmCommand, ["run", "build"], apiServerDir);

  console.log("Building game server...");
  runCommand(npmCommand, ["run", "build"], gameServerDir);

  console.log("Building frontend...");
  const frontendBuild = executeCommand(npmCommand, ["run", "build"], rootDir, buildEnv);
  if (frontendBuild.status !== 0) {
    const existingDistEntry = path.join(rootDir, "dist", "index.html");
    if (!existsSync(existingDistEntry)) {
      process.exit(frontendBuild.status ?? 1);
    }
    console.warn(
      "Frontend rebuild failed, but an existing dist/ build is available. Reusing the last successful frontend build for local startup.",
    );
  }
}

const apiOutFd = openSync(path.join(runtimeDir, "api-server.log"), "a");
const apiErrFd = openSync(path.join(runtimeDir, "api-server.error.log"), "a");
const gameOutFd = openSync(path.join(runtimeDir, "game-server.log"), "a");
const gameErrFd = openSync(path.join(runtimeDir, "game-server.error.log"), "a");
const webOutFd = openSync(path.join(runtimeDir, "web.log"), "a");
const webErrFd = openSync(path.join(runtimeDir, "web.error.log"), "a");

console.log("Starting API server...");
const apiProcess = spawn(process.execPath, ["--enable-source-maps", "dist/index.js"], {
  cwd: apiServerDir,
  env: apiEnv,
  detached: true,
  stdio: ["ignore", apiOutFd, apiErrFd],
  windowsHide: true,
});
apiProcess.unref();

await waitForUrl(`http://${publicApiHost}:${apiPort}/healthz`, 20_000);

console.log("Starting game server...");
const gameProcess = spawn(process.execPath, ["--enable-source-maps", "dist/index.js"], {
  cwd: gameServerDir,
  env: gameEnv,
  detached: true,
  stdio: ["ignore", gameOutFd, gameErrFd],
  windowsHide: true,
});
gameProcess.unref();

await waitForUrl(`http://${publicGameHost}:${gamePort}/`, 20_000);

console.log("Starting frontend static site...");
const webProcess = spawn(
  process.execPath,
  [path.join(scriptDir, "serve-static.mjs"), "--root", "dist", "--host", webHost, "--port", String(webPort)],
  {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", webOutFd, webErrFd],
    windowsHide: true,
  },
);
webProcess.unref();

await waitForUrl(`http://${webHost}:${webPort}`, 10_000);

const metadata = {
  startedAt: new Date().toISOString(),
  apiPid: apiProcess.pid,
  gamePid: gameProcess.pid,
  webPid: webProcess.pid,
  apiUrl: `http://${publicApiHost}:${apiPort}`,
  apiBaseUrl,
  gameUrl: `http://${publicGameHost}:${gamePort}/`,
  wsBaseUrl,
  healthUrl: `http://${publicApiHost}:${apiPort}/healthz`,
  webUrl: `http://${webHost}:${webPort}`,
  logs: {
    api: path.join(runtimeDir, "api-server.log"),
    apiError: path.join(runtimeDir, "api-server.error.log"),
    game: path.join(runtimeDir, "game-server.log"),
    gameError: path.join(runtimeDir, "game-server.error.log"),
    web: path.join(runtimeDir, "web.log"),
    webError: path.join(runtimeDir, "web.error.log"),
  },
};

writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

console.log("");
console.log(`Frontend: ${metadata.webUrl}`);
console.log(`API: ${metadata.apiBaseUrl}`);
console.log(`WS: ${metadata.wsBaseUrl}`);
console.log(`Gateway probe: ${metadata.gameUrl}`);
console.log(`Health: ${metadata.healthUrl}`);
console.log(`Runtime metadata: ${metadataPath}`);
