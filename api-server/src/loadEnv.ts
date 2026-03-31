import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

const mode = process.env.NODE_ENV?.trim();
const candidates = [
  mode ? `.env.${mode}.local` : "",
  mode ? `.env.${mode}` : "",
  ".env.local",
  ".env",
].filter((value) => value.length > 0);

for (const candidate of candidates) {
  const filePath = path.resolve(process.cwd(), candidate);
  if (!existsSync(filePath)) {
    continue;
  }
  loadDotenv({
    path: filePath,
    override: false,
  });
}
