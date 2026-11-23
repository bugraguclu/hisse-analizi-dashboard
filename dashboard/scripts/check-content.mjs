#!/usr/bin/env node
/**
 * Build-öncesi ve CI içerik/sözleşme doğrulayıcısı (Belif `check-cms.mjs` yaklaşımı).
 *
 * Kullanım:
 *   node scripts/check-content.mjs
 *   node scripts/check-content.mjs --export-preview ./path/to/preview-bundle.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkspace } from "./content-validator.mjs";

const DASHBOARD_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const exportIdx = args.indexOf("--export-preview");
const previewOut = exportIdx !== -1 ? args[exportIdx + 1] : null;

const { problems, stats, manifest } = validateWorkspace({ dashboardRoot: DASHBOARD_ROOT });

if (problems.length > 0) {
  console.error(`\n[check-content] ${problems.length} sözleşme hatası bulundu — derleme durduruldu:\n`);
  for (const [index, problem] of problems.entries()) {
    console.error(`${index + 1}. ${problem.title}`);
    console.error(`   Dosya: ${problem.file}`);
    console.error(`   Detay: ${problem.detail}\n`);
  }
  process.exit(1);
}

if (previewOut) {
  const resolved = path.resolve(DASHBOARD_ROOT, previewOut);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: "preview",
    stats,
    published: {
      screens: manifest.screens,
      metrics: manifest.metrics.filter((m) => m.status === "published"),
      guides: manifest.guides.filter((g) => g.status === "published"),
    },
    drafts: {
      metrics: manifest.metrics.filter((m) => m.status === "draft"),
      guides: manifest.guides.filter((g) => g.status === "draft"),
    },
  };
  writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[check-content] Önizleme manifesti yazıldı: ${resolved}`);
}

console.log(
  `[check-content] OK · ${stats.screens} ekran (${stats.checkedMobileRoutes ? "Web+iOS" : "Web"}), ` +
    `${stats.metrics} metrik, ${stats.publishedGuides} yayında / ${stats.draftGuides} taslak rehber, ` +
    `${stats.indicators} gösterge, ${stats.screenerRanges} kriter, ${stats.screenerPresets} hazır tarama, ` +
    `${stats.i18nKeys} i18n anahtarı (${stats.i18nDictionaries} sözlük).`,
);
