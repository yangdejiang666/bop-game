import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const sharedProtocolDir = path.join(rootDir, "shared-protocol");
const apiServerDir = path.join(rootDir, "api-server");
const runtimeDir = path.join(rootDir, ".tmp_local-stack");
const metadataPath = path.join(runtimeDir, "local-stack.json");

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

function executeCommand(command, commandArgs, cwd, env = process.env) {
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

function runCommand(command, commandArgs, cwd, env = process.env) {
  const result = executeCommand(command, commandArgs, cwd, env);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function stopRecordedProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(pid);
  } catch {
    // Ignore stale PIDs.
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

mkdirSync(runtimeDir, { recursive: true });

if (existsSync(metadataPath)) {
  const previousMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  stopRecordedProcess(previousMetadata.apiPid);
  stopRecordedProcess(previousMetadata.webPid);
}

const rootEnvFile = {
  ...parseEnvFile(path.join(rootDir, ".env")),
  ...parseEnvFile(path.join(rootDir, ".env.local")),
};

const apiEnvFile = {
  ...parseEnvFile(path.join(apiServerDir, ".env")),
  ...parseEnvFile(path.join(apiServerDir, ".env.local")),
};

const skipBuild = readFlag("--skip-build");
const apiHost = readArg("--api-host", apiEnvFile.API_HOST || "127.0.0.1");
const apiPort = Number(readArg("--api-port", apiEnvFile.API_PORT || "8788"));
const webHost = readArg("--web-host", rootEnvFile.LOCAL_WEB_HOST || "127.0.0.1");
const webPort = Number(readArg("--web-port", rootEnvFile.LOCAL_WEB_PORT || "4180"));
const publicApiHost = apiHost === "0.0.0.0" ? "127.0.0.1" : apiHost;
const defaultApiBaseUrl = `http://${publicApiHost}:${apiPort}/api/v1`;
const apiBaseUrl = readArg(
  "--api-base-url",
  rootEnvFile.VITE_API_BASE_URL || defaultApiBaseUrl,
);
const databaseUrl = readArg(
  "--database-url",
  apiEnvFile.DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@127.0.0.1:5432/bop",
);

const buildEnv = {
  ...process.env,
  ...rootEnvFile,
  VITE_API_BASE_URL: apiBaseUrl,
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

if (!skipBuild) {
  console.log("Building shared protocol...");
  runCommand(npmCommand, ["run", "build"], sharedProtocolDir);

  console.log("Building API server...");
  runCommand(npmCommand, ["run", "build"], apiServerDir);

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
  webPid: webProcess.pid,
  apiUrl: `http://${publicApiHost}:${apiPort}`,
  apiBaseUrl,
  healthUrl: `http://${publicApiHost}:${apiPort}/healthz`,
  webUrl: `http://${webHost}:${webPort}`,
  logs: {
    api: path.join(runtimeDir, "api-server.log"),
    apiError: path.join(runtimeDir, "api-server.error.log"),
    web: path.join(runtimeDir, "web.log"),
    webError: path.join(runtimeDir, "web.error.log"),
  },
};

writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

console.log("");
console.log(`Frontend: ${metadata.webUrl}`);
console.log(`API: ${metadata.apiBaseUrl}`);
console.log(`Health: ${metadata.healthUrl}`);
console.log(`Runtime metadata: ${metadataPath}`);
