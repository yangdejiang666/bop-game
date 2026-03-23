import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const args = process.argv.slice(2);

function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return args[index + 1] ?? fallback;
}

const rootDir = path.resolve(readArg("--root", "dist"));
const host = readArg("--host", "127.0.0.1");
const port = Number(readArg("--port", "4180"));

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".gltf", "model/gltf+json; charset=utf-8"],
  [".bin", "application/octet-stream"],
]);

function sanitizePathname(rawPathname) {
  const decoded = decodeURIComponent(rawPathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const relativePath = normalized.startsWith(path.sep)
    ? normalized.slice(1)
    : normalized;
  return relativePath;
}

async function resolveFilePath(requestPath) {
  const safeRelativePath = sanitizePathname(requestPath);
  let candidatePath = path.resolve(rootDir, safeRelativePath);

  if (!candidatePath.startsWith(rootDir)) {
    return null;
  }

  if (existsSync(candidatePath)) {
    const info = statSync(candidatePath);
    if (info.isDirectory()) {
      candidatePath = path.join(candidatePath, "index.html");
    }
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  const hasExplicitExtension = path.extname(candidatePath).length > 0;
  if (!hasExplicitExtension) {
    const spaEntry = path.join(rootDir, "index.html");
    await stat(spaEntry);
    return spaEntry;
  }

  return null;
}

await mkdir(rootDir, { recursive: true });

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end("Missing request URL");
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host ?? host}`);
  const filePath = await resolveFilePath(requestUrl.pathname).catch(() => null);

  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType =
    contentTypes.get(extension) ?? "application/octet-stream";
  const fileInfo = statSync(filePath);

  res.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": fileInfo.size,
    "Content-Type": contentType,
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Static site ready at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

