import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const runtimeDir = path.join(rootDir, ".tmp_local-stack");
const metadataPath = path.join(runtimeDir, "local-stack.json");

function terminateProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(metadataPath)) {
  console.log("No local stack metadata found. Nothing to stop.");
  process.exit(0);
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
const stopped = [];

if (terminateProcess(metadata.apiPid)) {
  stopped.push(`api:${metadata.apiPid}`);
}

if (terminateProcess(metadata.webPid)) {
  stopped.push(`web:${metadata.webPid}`);
}

rmSync(metadataPath, { force: true });

if (stopped.length === 0) {
  console.log("Local stack metadata cleared. No recorded process was still running.");
} else {
  console.log(`Stopped ${stopped.join(", ")}`);
}

