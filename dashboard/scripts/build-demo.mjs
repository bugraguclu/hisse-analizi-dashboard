/**
 * Static demo build (see src/lib/demo.ts): `next build` as a static export with
 * NEXT_PUBLIC_DEMO=1, then the recorded API responses (demo/data, written by
 * scripts/capture-demo-data.mjs) copied into out/demo-data/.
 *
 *   npm run build:demo -- [--base-path /hisse-analizi-dashboard]
 *
 * --base-path is the sub-path the site is served from (a GitHub Pages project
 * site: /<repository>); leave it out to serve out/ from the root.
 */
import { spawnSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: { "base-path": { type: "string", default: process.env.NEXT_PUBLIC_BASE_PATH ?? "" } },
});

const basePath = args["base-path"].trim().replace(/\/$/, "");
if (basePath && !basePath.startsWith("/")) throw new Error(`--base-path must start with "/": ${basePath}`);

const dataDir = path.join(root, "demo/data");
const manifest = JSON.parse(await readFile(path.join(dataDir, "manifest.json"), "utf8"));
if (manifest.version !== 1) throw new Error(`Unsupported demo data version: ${manifest.version}`);

const build = spawnSync(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_DEMO: "1", NEXT_PUBLIC_BASE_PATH: basePath },
});
if (build.status !== 0) process.exit(build.status ?? 1);

const out = path.join(root, "out");
await rm(path.join(out, "demo-data"), { recursive: true, force: true });
await cp(dataDir, path.join(out, "demo-data"), { recursive: true });
// Served as is: no Jekyll pass, which would drop the _next/ directory.
await writeFile(path.join(out, ".nojekyll"), "");

console.log(
  `\nStatic demo in out/ (base path "${basePath || "/"}"): ${Object.keys(manifest.responses).length} recorded responses from ${manifest.capturedAt}, stocks ${manifest.tickers.join(", ")}.`,
);
