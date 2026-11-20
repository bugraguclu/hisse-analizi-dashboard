#!/usr/bin/env node
/**
 * Automated web bundle and shipped-media size budget gate for Hisse Analizi.
 *
 * Usage:
 *   node scripts/check-bundle-budgets.mjs          # checks repo media assets
 *   node scripts/check-bundle-budgets.mjs --web    # also checks dashboard/.next/static after `npm run build`
 *
 * Baselines and ceilings live in `scripts/bundle-budgets.config.mjs`.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { BUNDLE_BUDGET_CONFIG } from "./bundle-budgets.config.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg", ".ico"]);

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function walkFiles(baseDir, relRoot, out = []) {
  if (!fs.existsSync(baseDir)) return out;
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    const full = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, relRoot, out);
    } else if (entry.isFile()) {
      out.push({
        path: toPosix(path.relative(relRoot, full)),
        absPath: full,
        bytes: fs.statSync(full).size,
      });
    }
  }
  return out;
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function gzipBytes(absPath) {
  return zlib.gzipSync(fs.readFileSync(absPath)).length;
}

function isForbiddenFile(filePath, forbiddenExtensions) {
  const lower = filePath.toLowerCase();
  const base = path.basename(lower);
  if (base === ".env" || base.startsWith(".env.")) return true;
  return forbiddenExtensions.includes(path.extname(lower));
}

export function checkBundleBudgets({
  rootDir = DEFAULT_ROOT,
  includeWeb = false,
  config = BUNDLE_BUDGET_CONFIG,
} = {}) {
  const rows = [];
  const violations = [];
  let topJsChunks = [];

  const record = (label, actualBytes, maxBytes, detail) => {
    const pct = maxBytes > 0 ? Math.round((actualBytes / maxBytes) * 100) : 0;
    const ok = actualBytes <= maxBytes;
    rows.push({ label, actualBytes, maxBytes, pct, ok, detail });
    if (!ok) {
      violations.push(
        `${label}: ${formatBytes(actualBytes)} exceeds budget ${formatBytes(maxBytes)} (${pct}%)${detail ? ` — ${detail}` : ""}`,
      );
    }
  };

  const appDir = path.join(rootDir, "dashboard", "src", "app");
  const publicDir = path.join(rootDir, "dashboard", "public");
  const mediaFiles = [...walkFiles(appDir, rootDir), ...walkFiles(publicDir, rootDir)].filter((file) =>
    MEDIA_EXTENSIONS.has(path.extname(file.path).toLowerCase()),
  );

  let mediaTotal = 0;
  for (const media of mediaFiles) {
    mediaTotal += media.bytes;
    record(`Shipped media (${media.path})`, media.bytes, config.repo.shippedMediaFileMaxBytes);
  }
  record("Shipped media total (app + public)", mediaTotal, config.repo.shippedMediaTotalMaxBytes);

  for (const pub of walkFiles(publicDir, rootDir)) {
    if (isForbiddenFile(pub.path, config.forbiddenShippedExtensions)) {
      violations.push(`Forbidden shipped file in public/: ${pub.path}`);
    }
  }

  if (includeWeb) {
    const staticDir = path.join(rootDir, "dashboard", ".next", "static");
    if (!fs.existsSync(staticDir)) {
      violations.push("dashboard/.next/static not found. Run `npm run build` in dashboard/ first.");
    } else {
      const staticFiles = walkFiles(staticDir, rootDir);
      const jsFiles = staticFiles
        .filter((f) => f.path.endsWith(".js"))
        .map((f) => ({ ...f, gzipBytes: gzipBytes(f.absPath) }));
      const cssFiles = staticFiles
        .filter((f) => f.path.endsWith(".css"))
        .map((f) => ({ ...f, gzipBytes: gzipBytes(f.absPath) }));

      const jsRaw = jsFiles.reduce((sum, f) => sum + f.bytes, 0);
      const jsGzip = jsFiles.reduce((sum, f) => sum + f.gzipBytes, 0);
      const cssRaw = cssFiles.reduce((sum, f) => sum + f.bytes, 0);
      const cssGzip = cssFiles.reduce((sum, f) => sum + f.gzipBytes, 0);
      const staticTotal = staticFiles.reduce((sum, f) => sum + f.bytes, 0);

      topJsChunks = [...jsFiles].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
      const largestRaw = topJsChunks[0];
      const largestGzip = [...jsFiles].sort((a, b) => b.gzipBytes - a.gzipBytes)[0];

      record("Web JS total (raw)", jsRaw, config.web.jsTotalRawMaxBytes, largestRaw ? `largest: ${largestRaw.path}` : undefined);
      record("Web JS total (gzip)", jsGzip, config.web.jsTotalGzipMaxBytes, largestGzip ? `largest: ${largestGzip.path}` : undefined);
      if (largestRaw) {
        record(`Largest JS chunk raw (${largestRaw.path})`, largestRaw.bytes, config.web.largestJsChunkRawMaxBytes);
      }
      if (largestGzip) {
        record(`Largest JS chunk gzip (${largestGzip.path})`, largestGzip.gzipBytes, config.web.largestJsChunkGzipMaxBytes);
      }
      record("Web CSS total (raw)", cssRaw, config.web.cssTotalRawMaxBytes);
      record("Web CSS total (gzip)", cssGzip, config.web.cssTotalGzipMaxBytes);
      record("Web .next/static total", staticTotal, config.web.staticTotalMaxBytes);

      for (const file of staticFiles) {
        if (isForbiddenFile(file.path, config.forbiddenShippedExtensions)) {
          violations.push(`Forbidden shipped file in .next/static/: ${file.path}`);
        }
      }
    }
  }

  return { ok: violations.length === 0, rows, violations, topJsChunks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const includeWeb = process.argv.includes("--web");
  const { ok, rows, violations, topJsChunks } = checkBundleBudgets({ includeWeb });

  console.log(
    `Bundle & media budgets (baseline ${BUNDLE_BUDGET_CONFIG.measuredAt}, mode: ${includeWeb ? "repo + web .next/static" : "repo media"}):`,
  );
  for (const row of rows) {
    const status = row.ok ? "OK  " : "FAIL";
    console.log(
      `  [${status}] ${formatBytes(row.actualBytes).padStart(10)} / ${formatBytes(row.maxBytes).padEnd(10)} (${String(row.pct).padStart(3)}%)  ${row.label}`,
    );
  }

  if (!ok) {
    console.error("\nBundle/media budget violations:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    if (topJsChunks.length > 0) {
      console.error("\nLargest JS chunks:");
      for (const chunk of topJsChunks) {
        console.error(`  - ${chunk.path}: ${formatBytes(chunk.bytes)} raw / ${formatBytes(chunk.gzipBytes)} gzip`);
      }
    }
    console.error(
      "\nTo resolve: trim or code-split the growing asset, or update the baseline in scripts/bundle-budgets.config.mjs with justification.",
    );
    process.exit(1);
  }

  console.log("All bundle and shipped-media budgets are within limits.");
}
