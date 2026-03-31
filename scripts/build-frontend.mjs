import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const distDir = path.join(rootDir, "dist");
const stagingDir = path.join(rootDir, ".tmp_frontend_build");
const assetsDir = path.join(distDir, "assets");
const stagingAssetsDir = path.join(stagingDir, "assets");
const publicDir = path.join(rootDir, "public");
const indexTemplatePath = path.join(rootDir, "index.html");
const esbuildBinaryPath =
  process.platform === "win32"
    ? path.join(rootDir, "node_modules", "@esbuild", "win32-x64", "esbuild.exe")
    : path.join(rootDir, "node_modules", "@esbuild", `${process.platform}-${process.arch}`, "bin", "esbuild");

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

const rootEnv = {
  ...parseEnvFile(path.join(rootDir, ".env")),
  ...parseEnvFile(path.join(rootDir, ".env.local")),
  ...process.env,
};

const viteEnv = Object.fromEntries(
  Object.entries(rootEnv).filter(([key]) => key.startsWith("VITE_")),
);

const defineEnv = {
  "import.meta.env": JSON.stringify({
    BASE_URL: "/",
    DEV: false,
    PROD: true,
    MODE: "production",
    ...viteEnv,
  }),
};

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingAssetsDir, { recursive: true });
mkdirSync(distDir, { recursive: true });
mkdirSync(assetsDir, { recursive: true });

const buildArgs = [
  "src/main.ts",
  "--bundle",
  `--outfile=${path.join(stagingAssetsDir, "app.js")}`,
  "--sourcemap",
  "--format=esm",
  "--platform=browser",
  "--target=es2022",
  "--legal-comments=none",
  "--charset=utf8",
  "--loader:.css=css",
  "--loader:.png=file",
  "--loader:.jpg=file",
  "--loader:.jpeg=file",
  "--loader:.svg=file",
  "--loader:.webp=file",
  "--loader:.gif=file",
  "--loader:.woff=file",
  "--loader:.woff2=file",
  "--loader:.ttf=file",
  "--loader:.eot=file",
  ...Object.entries(defineEnv).map(
    ([key, value]) => `--define:${key}=${value}`,
  ),
];

const buildResult = spawnSync(esbuildBinaryPath, buildArgs, {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit",
});

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

if (existsSync(publicDir)) {
  cpSync(publicDir, stagingDir, { recursive: true });
}

const indexTemplate = readFileSync(indexTemplatePath, "utf8");
const builtIndex = indexTemplate.replace(
  /<script type="module" src="\/src\/main\.ts"><\/script>/,
  [
    '<link rel="stylesheet" href="/assets/app.css" />',
    '<script type="module" src="/assets/app.js"></script>',
  ].join("\n    "),
);

writeFileSync(path.join(stagingDir, "index.html"), builtIndex, "utf8");
cpSync(stagingDir, distDir, { recursive: true, force: true });

console.log(`Frontend bundle written to ${distDir}`);
