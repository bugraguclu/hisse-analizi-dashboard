/**
 * Pre-build & CI content/contract validator (adapted from Belif's `scripts/check-cms.mjs`).
 *
 * Pure zero-dependency ESM JavaScript so it runs identically on Node 20 (CI & Docker) and Node 24
 * before `next build` starts. Every check returns structured `{ title, detail, file }` entries so
 * broken metric/guide/screener/indicator/i18n/route links stop the build with an exact pointer.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const LOCALES = ["tr", "en", "fr"];
const VALID_STATUSES = new Set(["published", "draft"]);

export const I18N_DICTIONARY_FILES = [
  "src/lib/i18n.ts",
  "src/components/tarama/i18n.ts",
  "src/components/events/i18n-dict.ts",
  "src/components/makro/i18n-dict.ts",
  "src/components/makro/calendar/i18n.ts",
  "src/components/stock/i18n-dict.ts",
  "src/components/charts/i18n.ts",
  "src/components/charts/drawings/i18n.ts",
  "src/components/charts/mini/i18n.ts",
];

function stripComments(source) {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      } else if (ch === "\n") {
        out += "\n";
      }
      continue;
    }
    if (inSingle || inDouble || inTemplate) {
      out += ch;
      if (ch === "\\") {
        if (next !== undefined) {
          out += next;
          i += 1;
        }
        continue;
      }
      if (inSingle && ch === "'") inSingle = false;
      else if (inDouble && ch === '"') inDouble = false;
      else if (inTemplate && ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === "`") inTemplate = true;
    out += ch;
  }
  return out;
}

/** Extracts balanced `{ ... }` or `[ ... ]` starting from the first open delimiter after `startIndex`. */
function extractBalanced(source, startIndex, openChar, closeChar) {
  const start = source.indexOf(openChar, startIndex);
  if (start === -1) return null;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inSingle || inDouble || inTemplate) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (inSingle && ch === "'") inSingle = false;
      else if (inDouble && ch === '"') inDouble = false;
      else if (inTemplate && ch === "`") inTemplate = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === "`") inTemplate = true;
    else if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** Extracts top-level string items from a flat TS string array literal. */
export function parseStringArrayConst(source, constName) {
  const clean = stripComments(source);
  const re = new RegExp(`(?:export\\s+)?const\\s+${constName}\\b[^=]*=`);
  const match = re.exec(clean);
  if (!match) return null;
  const bracket = extractBalanced(clean, match.index + match[0].length, "[", "]");
  if (!bracket) return null;
  return [...bracket.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Extracts top-level `{ tr, en, fr }` entries from a dictionary object literal. */
export function parseLocaleDict(source) {
  const clean = stripComments(source);
  const dictMatch = /(?:export\s+)?const\s+(?:translations|dict|DICT|STRINGS)\b[^=]*=/.exec(clean);
  if (!dictMatch) return null;
  const block = extractBalanced(clean, dictMatch.index + dictMatch[0].length, "{", "}");
  if (!block) return null;

  const entries = new Map();
  // Walk top-level key: { ... } pairs inside the dictionary block.
  let i = 1;
  while (i < block.length - 1) {
    while (i < block.length - 1 && /[\s,]/.test(block[i])) i += 1;
    if (i >= block.length - 1) break;

    let key = "";
    if (block[i] === '"' || block[i] === "'") {
      const quote = block[i];
      i += 1;
      while (i < block.length && block[i] !== quote) {
        if (block[i] === "\\") i += 1;
        key += block[i];
        i += 1;
      }
      i += 1;
    } else {
      while (i < block.length && /[A-Za-z0-9_$.-]/.test(block[i])) {
        key += block[i];
        i += 1;
      }
    }

    while (i < block.length && /[\s:]/.test(block[i])) i += 1;
    if (!key || block[i] !== "{") break;

    const valueBlock = extractBalanced(block, i, "{", "}");
    if (!valueBlock) break;
    i += valueBlock.length;

    const localeValues = {};
    for (const locale of LOCALES) {
      const locRe = new RegExp(`(?:^|[,{\\s])${locale}\\s*:\\s*(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)')`);
      const m = locRe.exec(valueBlock);
      if (m) {
        const raw = m[1] ?? m[2] ?? "";
        localeValues[locale] = raw.replace(/\\u00a0/gi, "\u00a0").replace(/\\(["'\\])/g, "$1");
      }
    }
    entries.set(key, localeValues);
  }
  return entries;
}

function extractPlaceholders(text) {
  if (typeof text !== "string") return [];
  return [...new Set([...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]))].sort();
}

function parseTaramaModel(source) {
  const clean = stripComments(source);
  const filterGroups = parseStringArrayConst(clean, "FILTER_GROUPS") ?? [];
  const views = parseStringArrayConst(clean, "VIEWS") ?? [];
  const crossValues = parseStringArrayConst(clean, "CROSS_VALUES") ?? [];
  const recValues = parseStringArrayConst(clean, "REC_VALUES") ?? [];

  // RANGE_FILTERS
  const rangeFilters = [];
  const rfMatch = /export\s+const\s+RANGE_FILTERS\b[^=]*=/.exec(clean);
  if (rfMatch) {
    const arr = extractBalanced(clean, rfMatch.index + rfMatch[0].length, "[", "]") ?? "";
    let pos = 1;
    while (pos < arr.length) {
      const nextBrace = arr.indexOf("{", pos);
      if (nextBrace === -1) break;
      const obj = extractBalanced(arr, nextBrace, "{", "}");
      if (!obj) break;
      pos = nextBrace + obj.length;
      const key = /\bkey\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];
      const group = /\bgroup\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];
      if (key) rangeFilters.push({ key, group });
    }
  }

  // PRESETS
  const presets = [];
  const pMatch = /export\s+const\s+PRESETS\b[^=]*=/.exec(clean);
  if (pMatch) {
    const arr = extractBalanced(clean, pMatch.index + pMatch[0].length, "[", "]") ?? "";
    let pos = 1;
    while (pos < arr.length) {
      const nextBrace = arr.indexOf("{", pos);
      if (nextBrace === -1) break;
      const obj = extractBalanced(arr, nextBrace, "{", "}");
      if (!obj) break;
      pos = nextBrace + obj.length;
      const id = /\bid\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];
      const group = /\bgroup\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];
      const view = /\bview\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];
      const rangesMatch = /\branges\s*:\s*\{/.exec(obj);
      const rangeKeys = [];
      if (rangesMatch) {
        const rBlock = extractBalanced(obj, rangesMatch.index + rangesMatch[0].length - 1, "{", "}") ?? "";
        let rPos = 1;
        while (rPos < rBlock.length - 1) {
          const kMatch = /^\s*,?\s*([a-zA-Z0-9_]+)\s*:\s*\{/.exec(rBlock.slice(rPos));
          if (!kMatch) break;
          rangeKeys.push(kMatch[1]);
          const innerStart = rPos + kMatch[0].length - 1;
          const inner = extractBalanced(rBlock, innerStart, "{", "}");
          if (!inner) break;
          rPos = innerStart + inner.length;
        }
      }
      if (id) presets.push({ id, group, view, rangeKeys });
    }
  }

  // VIEW_COLUMNS
  const viewColumns = new Map();
  const vcMatch = /export\s+const\s+VIEW_COLUMNS\b[^=]*=/.exec(clean);
  if (vcMatch) {
    const obj = extractBalanced(clean, vcMatch.index + vcMatch[0].length, "{", "}") ?? "";
    for (const view of views) {
      const vRe = new RegExp(`\\b${view}\\s*:\\s*\\[`);
      const m = vRe.exec(obj);
      if (!m) continue;
      const arr = extractBalanced(obj, m.index + m[0].length - 1, "[", "]") ?? "";
      viewColumns.set(
        view,
        [...arr.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]),
      );
    }
  }

  return { filterGroups, views, crossValues, recValues, rangeFilters, presets, viewColumns };
}

function parseIndicatorCatalog(source) {
  const clean = stripComments(source);
  const order = parseStringArrayConst(clean, "INDICATOR_ORDER") ?? [];
  const indMatch = /export\s+const\s+INDICATORS\b[^=]*=/.exec(clean);
  const indicators = new Map();
  if (indMatch) {
    const block = extractBalanced(clean, indMatch.index + indMatch[0].length, "{", "}") ?? "";
    for (const m of block.matchAll(/\b([a-z0-9_]+)\s*:\s*define\(\{/g)) {
      const kind = m[1];
      const defObj = extractBalanced(block, m.index + m[0].length - 1, "{", "}") ?? "";
      const nameBlock = /\bname\s*:\s*\{/.exec(defObj);
      const descBlock = /\bdescription\s*:\s*\{/.exec(defObj);
      const kwBlock = /\bkeywords\s*:\s*\[/.exec(defObj);
      const extractLoc = (hit) => {
        if (!hit) return {};
        const sub = extractBalanced(defObj, hit.index + hit[0].length - 1, "{", "}") ?? "";
        const res = {};
        for (const loc of LOCALES) {
          const lm = new RegExp(`(?:^|[,{\\s])${loc}\\s*:\\s*(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)')`).exec(sub);
          if (lm) res[loc] = lm[1] ?? lm[2] ?? "";
        }
        return res;
      };
      const keywords = kwBlock
        ? [...(extractBalanced(defObj, kwBlock.index + kwBlock[0].length - 1, "[", "]") ?? "").matchAll(/["']([^"']+)["']/g)].map((x) => x[1])
        : [];
      indicators.set(kind, {
        kind,
        name: extractLoc(nameBlock),
        description: extractLoc(descBlock),
        keywords,
      });
    }
  }
  return { order, indicators };
}

function parseSectionLabels(source) {
  const clean = stripComments(source);
  const m = /export\s+const\s+SECTION_LABELS\b[^=]*=/.exec(clean);
  if (!m) return [];
  const block = extractBalanced(clean, m.index + m[0].length, "{", "}") ?? "";
  return [...block.matchAll(/\b([a-z0-9_-]+)\s*:\s*["']([^"']+)["']/gi)].map((x) => ({
    section: x[1],
    labelKey: x[2],
  }));
}

function webRouteExists(dashboardRoot, webPath) {
  const clean = webPath.replace(/^\/+|\/+$/g, "");
  const pageFile = clean
    ? path.join(dashboardRoot, "src/app", clean, "page.tsx")
    : path.join(dashboardRoot, "src/app/page.tsx");
  return existsSync(pageFile);
}

function iosRouteExists(mobileRoot, iosRoute) {
  const clean = iosRoute.replace(/^\/+|\/+$/g, "");
  const candidates = [
    path.join(mobileRoot, "app", `${clean}.tsx`),
    path.join(mobileRoot, "app", clean, "index.tsx"),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

function validateLocalizedObject(obj, contextLabel, file, fail) {
  if (!obj || typeof obj !== "object") {
    fail(`${contextLabel} yerelleştirilmiş metin nesnesi eksik`, "tr / en / fr alanları zorunlu.", file);
    return;
  }
  for (const loc of LOCALES) {
    if (typeof obj[loc] !== "string" || obj[loc].trim() === "") {
      fail(`${contextLabel} → "${loc}" çevirisi boş veya eksik`, "Üç dilde (tr/en/fr) boş olmayan metin tanımlanmalı.", file);
    }
  }
}

/**
 * Validates all web/iOS content contracts in `dashboardRoot` (and optionally cross-checks
 * `mobileRoot` when present on disk).
 *
 * @param {{ dashboardRoot: string; mobileRoot?: string; manifestOverride?: Record<string, unknown> | null }} options
 */
export function validateWorkspace({
  dashboardRoot,
  mobileRoot = path.resolve(dashboardRoot, "../mobile"),
  manifestOverride = null,
}) {
  const problems = [];
  const fail = (title, detail, file) => problems.push({ title, detail, file });
  const read = (rel) => readFileSync(path.join(dashboardRoot, rel), "utf8");

  // 1 · Tarama (model.ts ↔ i18n.ts)
  const taramaModel = parseTaramaModel(read("src/components/tarama/model.ts"));
  const taramaDict = parseLocaleDict(read("src/components/tarama/i18n.ts")) ?? new Map();
  const groupSet = new Set(taramaModel.filterGroups);
  const rangeSet = new Set(taramaModel.rangeFilters.map((r) => r.key));
  const presetSet = new Set(taramaModel.presets.map((p) => p.id));
  const viewSet = new Set(taramaModel.views);

  for (const group of taramaModel.filterGroups) {
    if (!taramaDict.has(`group.${group}`)) {
      fail(`Tarama grubu "${group}" için i18n anahtarı yok`, `src/components/tarama/i18n.ts içinde "group.${group}" tanımlanmalı.`, "src/components/tarama/i18n.ts");
    }
  }
  for (const def of taramaModel.rangeFilters) {
    if (!groupSet.has(def.group)) {
      fail(`Aralık kriteri "${def.key}" bilinmeyen gruba bağlı: "${def.group}"`, `Geçerli gruplar: ${taramaModel.filterGroups.join(", ")}`, "src/components/tarama/model.ts");
    }
    for (const key of [`range.${def.key}`, `range.${def.key}.short`]) {
      if (!taramaDict.has(key)) {
        fail(`Aralık kriteri "${def.key}" etiketi eksik: "${key}"`, "Tarama panelinde veya çip özetinde ham anahtar görünür.", "src/components/tarama/i18n.ts");
      }
    }
  }
  for (const preset of taramaModel.presets) {
    if (!groupSet.has(preset.group)) {
      fail(`Hazır tarama "${preset.id}" bilinmeyen gruba bağlı: "${preset.group}"`, `Geçerli gruplar: ${taramaModel.filterGroups.join(", ")}`, "src/components/tarama/model.ts");
    }
    if (!taramaDict.has(`preset.${preset.id}`)) {
      fail(`Hazır tarama "${preset.id}" için i18n anahtarı yok`, `"preset.${preset.id}" tarama/i18n.ts içinde tanımlanmalı.`, "src/components/tarama/i18n.ts");
    }
    if (preset.view && !viewSet.has(preset.view)) {
      fail(`Hazır tarama "${preset.id}" geçersiz sütun görünümüne işaret ediyor: "${preset.view}"`, `Geçerli görünümler: ${taramaModel.views.join(", ")}`, "src/components/tarama/model.ts");
    }
    for (const rk of preset.rangeKeys) {
      if (!rangeSet.has(rk)) {
        fail(`Hazır tarama "${preset.id}" tanımlı olmayan aralık anahtarı kullanıyor: "${rk}"`, "RANGE_FILTERS içinde karşılığı yok.", "src/components/tarama/model.ts");
      }
    }
    const ruleEntry = taramaDict.get(`preset.${preset.id}.rule`);
    if (ruleEntry) {
      for (const loc of LOCALES) {
        for (const ph of extractPlaceholders(ruleEntry[loc])) {
          if (!preset.rangeKeys.includes(ph)) {
            fail(`"preset.${preset.id}.rule" (${loc}) bilinmeyen yer tutucu kullanıyor: {${ph}}`, `Preset aralıkları: ${preset.rangeKeys.join(", ") || "yok"}`, "src/components/tarama/i18n.ts");
          }
        }
      }
    }
  }
  for (const view of taramaModel.views) {
    if (!taramaDict.has(`view.${view}`)) {
      fail(`Tarama görünümü "${view}" etiketi eksik`, `"view.${view}" tarama/i18n.ts içinde tanımlanmalı.`, "src/components/tarama/i18n.ts");
    }
    for (const col of taramaModel.viewColumns.get(view) ?? []) {
      if (!taramaDict.has(`col.${col}`)) {
        fail(`Tarama sütunu "${col}" (${view}) etiketi eksik`, `"col.${col}" tarama/i18n.ts içinde tanımlanmalı.`, "src/components/tarama/i18n.ts");
      }
    }
  }
  for (const rec of taramaModel.recValues) {
    if (!taramaDict.has(`rec.${rec}`)) {
      fail(`Analist önerisi "${rec}" etiketi eksik`, `"rec.${rec}" tarama/i18n.ts içinde tanımlanmalı.`, "src/components/tarama/i18n.ts");
    }
  }
  for (const cross of taramaModel.crossValues) {
    if (!taramaDict.has(`signal.${cross}`) || !taramaDict.has(`rule.cross.${cross}`)) {
      fail(`SMA kesişimi "${cross}" i18n anahtarları eksik`, `"signal.${cross}" ve "rule.cross.${cross}" tanımlanmalı.`, "src/components/tarama/i18n.ts");
    }
  }

  // 2 · Grafik Göstergeleri (indicator-catalog.ts)
  const indicatorCatalog = parseIndicatorCatalog(read("src/components/charts/indicator-catalog.ts"));
  const indicatorKinds = new Set(indicatorCatalog.indicators.keys());
  const orderSet = new Set(indicatorCatalog.order);
  if (orderSet.size !== indicatorCatalog.order.length) {
    fail("INDICATOR_ORDER içinde yinelenen gösterge anahtarı var", "Her gösterge menü sırasına yalnızca bir kez yazılmalı.", "src/components/charts/indicator-catalog.ts");
  }
  for (const kind of indicatorKinds) {
    if (!orderSet.has(kind)) {
      fail(`Gösterge "${kind}" INDICATOR_ORDER listesinde yok`, "Menüde görünmeyecektir.", "src/components/charts/indicator-catalog.ts");
    }
  }
  for (const kind of indicatorCatalog.order) {
    if (!indicatorKinds.has(kind)) {
      fail(`INDICATOR_ORDER tanımsız göstergeye işaret ediyor: "${kind}"`, "INDICATORS kataloğunda karşılığı yok.", "src/components/charts/indicator-catalog.ts");
    }
  }
  for (const [kind, def] of indicatorCatalog.indicators) {
    validateLocalizedObject(def.name, `Gösterge "${kind}" adı`, "src/components/charts/indicator-catalog.ts", fail);
    validateLocalizedObject(def.description, `Gösterge "${kind}" açıklaması`, "src/components/charts/indicator-catalog.ts", fail);
    if (!def.keywords.length) {
      fail(`Gösterge "${kind}" arama anahtar kelimeleri boş`, "Aramada bulunabilmesi için en az bir anahtar kelime gerekli.", "src/components/charts/indicator-catalog.ts");
    }
  }

  // 3 · Tüm i18n sözlükleri (TR / EN / FR + placeholder eşleşmesi)
  const sharedDict = parseLocaleDict(read("src/lib/i18n.ts")) ?? new Map();
  let totalI18nKeys = 0;
  for (const relPath of I18N_DICTIONARY_FILES) {
    const dict = parseLocaleDict(read(relPath));
    if (!dict || dict.size === 0) {
      fail(`Sözlük dosyası okunamadı: ${relPath}`, "Beklenen { tr, en, fr } sözlük yapısı bulunamadı.", relPath);
      continue;
    }
    totalI18nKeys += dict.size;
    for (const [key, values] of dict) {
      for (const loc of LOCALES) {
        if (typeof values[loc] !== "string" || values[loc].trim() === "") {
          fail(`${relPath} → "${key}" için "${loc}" metni eksik veya boş`, "Üç dilde boş olmayan metin gereklidir.", relPath);
        }
      }
      const trPh = extractPlaceholders(values.tr);
      for (const loc of ["en", "fr"]) {
        const locPh = extractPlaceholders(values[loc]);
        if (trPh.join(",") !== locPh.join(",")) {
          fail(
            `${relPath} → "${key}" yer tutucuları uyuşmuyor (tr ↔ ${loc})`,
            `tr: [${trPh.join(", ")}] · ${loc}: [${locPh.join(", ")}]`,
            relPath,
          );
        }
      }
    }
  }

  // 4 · Navigasyon & Ekran Rotaları (nav.ts ↔ src/app)
  const sections = parseSectionLabels(read("src/components/layout/nav.ts"));
  for (const { section, labelKey } of sections) {
    if (!sharedDict.has(labelKey)) {
      fail(`nav.ts SECTION_LABELS["${section}"] tanımsız i18n anahtarı: "${labelKey}"`, "src/lib/i18n.ts içinde karşılığı yok.", "src/components/layout/nav.ts");
    }
    const hasStatic = webRouteExists(dashboardRoot, `/${section}`);
    const hasTicker = webRouteExists(dashboardRoot, `/${section}/[ticker]`);
    if (!hasStatic && !hasTicker) {
      fail(`nav.ts bölümü "/${section}" için Next.js sayfası yok`, `src/app/${section}/page.tsx veya src/app/${section}/[ticker]/page.tsx bulunamadı.`, "src/components/layout/nav.ts");
    }
  }

  // 5 · Ortak İçerik & Ekran Manifesti (content/manifest.json)
  const manifestFile = "content/manifest.json";
  const manifest = manifestOverride ?? JSON.parse(read(manifestFile));
  const checkMobileRoutes = existsSync(path.join(mobileRoot, "app"));

  const screenIds = new Set();
  for (const screen of manifest.screens ?? []) {
    if (!screen.id || screenIds.has(screen.id)) {
      fail(`Manifest ekran kimliği geçersiz veya yinelenmiş: "${screen.id}"`, "Her ekranın benzersiz id alanı olmalı.", manifestFile);
      continue;
    }
    screenIds.add(screen.id);
    validateLocalizedObject(screen.title, `Ekran "${screen.id}" başlığı`, manifestFile, fail);
    if (!screen.webPath || !webRouteExists(dashboardRoot, screen.webPath)) {
      fail(`Manifest ekranı "${screen.id}" kırık web yoluna işaret ediyor: "${screen.webPath}"`, "dashboard/src/app altında karşılık gelen page.tsx yok.", manifestFile);
    }
    if (checkMobileRoutes && (!screen.iosRoute || !iosRouteExists(mobileRoot, screen.iosRoute))) {
      fail(`Manifest ekranı "${screen.id}" kırık iOS yoluna işaret ediyor: "${screen.iosRoute}"`, "mobile/app altında karşılık gelen ekran dosyası yok.", manifestFile);
    }
  }

  const metricsById = new Map();
  for (const metric of manifest.metrics ?? []) {
    if (!metric.id || metricsById.has(metric.id)) {
      fail(`Manifest metrik kimliği geçersiz veya yinelenmiş: "${metric.id}"`, "Her metriğin benzersiz id alanı olmalı.", manifestFile);
      continue;
    }
    metricsById.set(metric.id, metric);
    if (!VALID_STATUSES.has(metric.status)) {
      fail(`Metrik "${metric.id}" geçersiz durum taşıyor: "${metric.status}"`, 'Yalnızca "published" veya "draft" olabilir.', manifestFile);
    }
    validateLocalizedObject(metric.title, `Metrik "${metric.id}" başlığı`, manifestFile, fail);
    validateLocalizedObject(metric.summary, `Metrik "${metric.id}" özeti`, manifestFile, fail);
    validateLocalizedObject(metric.source, `Metrik "${metric.id}" kaynağı`, manifestFile, fail);
    if (!screenIds.has(metric.screenId)) {
      fail(`Metrik "${metric.id}" tanımsız ekrana bağlı: "${metric.screenId}"`, "manifest.screens içinde tanımlı değil.", manifestFile);
    }
    if (metric.screenerRangeKey && !rangeSet.has(metric.screenerRangeKey)) {
      fail(`Metrik "${metric.id}" kaldırılmış veya tanımsız tarama kriterine bağlı: "${metric.screenerRangeKey}"`, "src/components/tarama/model.ts → RANGE_FILTERS içinde yok.", manifestFile);
    }
    for (const presetId of metric.screenerPresetIds ?? []) {
      if (!presetSet.has(presetId)) {
        fail(`Metrik "${metric.id}" tanımsız hazır taramaya bağlı: "${presetId}"`, "src/components/tarama/model.ts → PRESETS içinde yok.", manifestFile);
      }
    }
    if (metric.indicatorKind && !indicatorKinds.has(metric.indicatorKind)) {
      fail(`Metrik "${metric.id}" tanımsız grafik göstergesine bağlı: "${metric.indicatorKind}"`, "src/components/charts/indicator-catalog.ts → INDICATORS içinde yok.", manifestFile);
    }
  }

  const guidesById = new Map();
  const slugSet = new Set();
  for (const guide of manifest.guides ?? []) {
    if (!guide.id || guidesById.has(guide.id)) {
      fail(`Manifest rehber kimliği geçersiz veya yinelenmiş: "${guide.id}"`, "Her rehberin benzersiz id alanı olmalı.", manifestFile);
      continue;
    }
    if (!guide.slug || slugSet.has(guide.slug)) {
      fail(`Manifest rehber slug'ı geçersiz veya yinelenmiş: "${guide.slug}"`, "Her rehberin benzersiz URL slug'ı olmalı.", manifestFile);
    }
    slugSet.add(guide.slug);
    guidesById.set(guide.id, guide);
    if (!VALID_STATUSES.has(guide.status)) {
      fail(`Rehber "${guide.id}" geçersiz durum taşıyor: "${guide.status}"`, 'Yalnızca "published" veya "draft" olabilir.', manifestFile);
    }
    validateLocalizedObject(guide.title, `Rehber "${guide.id}" başlığı`, manifestFile, fail);
    validateLocalizedObject(guide.summary, `Rehber "${guide.id}" özeti`, manifestFile, fail);
    if (!screenIds.has(guide.screenId)) {
      fail(`Rehber "${guide.id}" tanımsız ekrana bağlı: "${guide.screenId}"`, "manifest.screens içinde tanımlı değil.", manifestFile);
    }
    for (const metricId of guide.metricIds ?? []) {
      const targetMetric = metricsById.get(metricId);
      if (!targetMetric) {
        fail(`Rehber "${guide.id}" tanımsız metriğe bağlı: "${metricId}"`, "manifest.metrics içinde bulunamadı.", manifestFile);
      } else if (guide.status === "published" && targetMetric.status === "draft") {
        fail(`Yayındaki rehber "${guide.id}" taslak metriğe bağlı: "${metricId}"`, "Yayındaki içerik yalnızca published metriklere bağlanabilir.", manifestFile);
      }
    }
    for (const presetId of guide.presetIds ?? []) {
      if (!presetSet.has(presetId)) {
        fail(`Rehber "${guide.id}" tanımsız hazır taramaya bağlı: "${presetId}"`, "src/components/tarama/model.ts → PRESETS içinde yok.", manifestFile);
      }
    }
    for (const kind of guide.indicatorKinds ?? []) {
      if (!indicatorKinds.has(kind)) {
        fail(`Rehber "${guide.id}" tanımsız grafik göstergesine bağlı: "${kind}"`, "src/components/charts/indicator-catalog.ts → INDICATORS içinde yok.", manifestFile);
      }
    }
  }

  for (const guide of guidesById.values()) {
    for (const relId of guide.relatedGuideIds ?? []) {
      if (relId === guide.id) {
        fail(`Rehber "${guide.id}" kendine referans veriyor`, "relatedGuideIds içinde kendi kimliği bulunamaz.", manifestFile);
        continue;
      }
      const target = guidesById.get(relId);
      if (!target) {
        fail(`Rehber "${guide.id}" tanımsız ilgili rehbere bağlı: "${relId}"`, "manifest.guides içinde bulunamadı.", manifestFile);
      } else if (guide.status === "published" && target.status === "draft") {
        fail(`Yayındaki rehber "${guide.id}" taslak rehbere bağlı: "${relId}"`, "Üretim paketinde kırık bağlantı oluşmaması için yalnızca published rehberlere bağlanabilir.", manifestFile);
      }
    }
  }

  const publishedGuides = (manifest.guides ?? []).filter((g) => g.status === "published").length;
  const draftGuides = (manifest.guides ?? []).filter((g) => g.status === "draft").length;

  return {
    problems,
    stats: {
      screens: screenIds.size,
      metrics: metricsById.size,
      publishedGuides,
      draftGuides,
      indicators: indicatorKinds.size,
      screenerRanges: rangeSet.size,
      screenerPresets: presetSet.size,
      i18nDictionaries: I18N_DICTIONARY_FILES.length,
      i18nKeys: totalI18nKeys,
      checkedMobileRoutes: checkMobileRoutes,
    },
    manifest,
  };
}
