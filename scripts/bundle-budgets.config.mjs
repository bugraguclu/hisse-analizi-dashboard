/**
 * Canonical repository media and Next.js production output size budgets for
 * Hisse Analizi Dashboard.
 *
 * Baselines were measured on 2026-11-20 from `dashboard/.next/static` after a
 * clean `npm run build`, with ~30-38% headroom so routine feature work passes
 * while accidental multi-megabyte dependencies or oversized chart/widget chunks
 * fail CI immediately and name the offending asset.
 */

const KIB = 1024;
const MIB = 1024 * 1024;

export const BUNDLE_BUDGET_CONFIG = Object.freeze({
  measuredAt: "2026-11-20",
  repo: Object.freeze({
    /** Baseline: 0.8 KiB (apple-icon.png), 1.6 KiB (favicon.ico), 0.2 KiB (icon.svg). */
    shippedMediaFileMaxBytes: 256 * KIB,
    /** Baseline: 2.6 KiB total across dashboard/src/app + dashboard/public. */
    shippedMediaTotalMaxBytes: 1 * MIB,
  }),
  web: Object.freeze({
    /** Baseline: 2,700.6 KiB (2.64 MiB) raw across 46 Next.js static JS chunks. */
    jsTotalRawMaxBytes: Math.round(3.5 * MIB),
    /** Baseline: 864.4 KiB (0.84 MiB) gzipped. */
    jsTotalGzipMaxBytes: Math.round(1.15 * MIB),
    /** Baseline: 519.8 KiB raw (largest single chart/runtime JS chunk). */
    largestJsChunkRawMaxBytes: 680 * KIB,
    /** Baseline: 150.8 KiB gzipped (largest single JS chunk). */
    largestJsChunkGzipMaxBytes: 200 * KIB,
    /** Baseline: 121.5 KiB raw CSS. */
    cssTotalRawMaxBytes: 180 * KIB,
    /** Baseline: 21.5 KiB gzipped CSS. */
    cssTotalGzipMaxBytes: 35 * KIB,
    /** Baseline: 3,338.2 KiB (3.26 MiB) total across dashboard/.next/static/. */
    staticTotalMaxBytes: Math.round(4.5 * MIB),
  }),
  /** Secrets, raw databases or signing material must never ship in public/ or .next/static/. */
  forbiddenShippedExtensions: Object.freeze([".env", ".pem", ".key", ".sqlite", ".db", ".p12", ".mobileprovision"]),
});
