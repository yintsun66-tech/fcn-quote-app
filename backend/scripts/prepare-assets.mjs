import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(backendDirectory, "..");
const outputDirectory = resolve(backendDirectory, "public");
const assets = [
  "index.html",
  "styles.css",
  "styles-dark.css",
  "app.js",
  "mail-compose.mjs",
  "backend-client.js",
  "market-analysis.mjs",
  "market-resources.mjs",
  "earnings-advisory.mjs",
  "follow-board.html",
  "follow-board.css",
  "follow-board-dark.css",
  "follow-board.mjs",
  "guide.html",
  "version-status.html",
  "交易所查詢0715.csv",
  "vendor/html2canvas-1.4.1.min.js",
  "backend/shared/email-formats.js"
];

await rm(outputDirectory, { recursive: true, force: true });
for (const relativePath of assets) {
  const destination = resolve(outputDirectory, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(repositoryDirectory, relativePath), destination);
}
