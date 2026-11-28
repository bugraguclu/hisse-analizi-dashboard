import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface StyleRule {
  file: string;
  selectors: string;
  body: string;
  context: string[];
}

interface KeyframeBlock {
  file: string;
  name: string;
  body: string;
}

function collectCssFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectCssFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".css")) files.push(full);
  }
  return files.sort();
}

function stripComments(css: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < css.length) {
        out += css[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\" && i + 1 < css.length) i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

function splitTopLevelDeclarationsAndBlocks(body: string): { declarations: string; nested: string } {
  let declarations = "";
  let nested = "";
  let i = 0;
  let start = 0;
  let parenDepth = 0;
  let quote: string | null = null;
  while (i < body.length) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\" && i + 1 < body.length) i += 1;
      else if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "(") parenDepth += 1;
    else if (ch === ")" && parenDepth > 0) parenDepth -= 1;
    else if (parenDepth === 0 && ch === ";") {
      declarations += body.slice(start, i + 1);
      start = i + 1;
    } else if (parenDepth === 0 && ch === "{") {
      const close = findMatchingBrace(body, i);
      nested += body.slice(start, close + 1);
      i = close;
      start = i + 1;
    }
    i += 1;
  }
  declarations += body.slice(start);
  return { declarations: declarations.trim(), nested: nested.trim() };
}

function parseCss(
  css: string,
  file: string,
  context: string[] = [],
  rules: StyleRule[] = [],
  keyframes: KeyframeBlock[] = [],
): { rules: StyleRule[]; keyframes: KeyframeBlock[] } {
  let i = 0;
  let start = 0;
  let parenDepth = 0;
  let quote: string | null = null;

  while (i < css.length) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\" && i + 1 < css.length) i += 1;
      else if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ")" && parenDepth > 0) {
      parenDepth -= 1;
      i += 1;
      continue;
    }
    if (parenDepth === 0 && ch === ";") {
      start = i + 1;
      i += 1;
      continue;
    }
    if (parenDepth === 0 && ch === "{") {
      const prelude = css.slice(start, i).replace(/\s+/g, " ").trim();
      const close = findMatchingBrace(css, i);
      const inner = css.slice(i + 1, close);

      if (prelude.startsWith("@keyframes ")) {
        keyframes.push({ file, name: prelude.slice("@keyframes ".length).trim(), body: inner });
      } else if (prelude.startsWith("@theme") || prelude.startsWith("@property")) {
        // Ignore token/property registrations when checking style rules.
      } else if (prelude.startsWith("@")) {
        const nextContext = [...context, prelude];
        const { declarations, nested } = splitTopLevelDeclarationsAndBlocks(inner);
        if (declarations) {
          rules.push({ file, selectors: context[0] ?? prelude, body: declarations, context: nextContext });
        }
        if (nested) parseCss(nested, file, nextContext, rules, keyframes);
      } else if (prelude) {
        const { declarations, nested } = splitTopLevelDeclarationsAndBlocks(inner);
        if (declarations) rules.push({ file, selectors: prelude, body: declarations, context });
        if (nested) parseCss(nested, file, [...context, prelude], rules, keyframes);
      }

      i = close + 1;
      start = i;
      continue;
    }
    i += 1;
  }

  return { rules, keyframes };
}

const cssFiles = collectCssFiles(SRC_ROOT);
const parsed = cssFiles.map((fullPath) => {
  const rel = path.relative(SRC_ROOT, fullPath);
  const raw = fs.readFileSync(fullPath, "utf8");
  const clean = stripComments(raw);
  return { rel, raw, clean, ...parseCss(clean, rel) };
});

const allRules = parsed.flatMap((file) => file.rules);
const allKeyframes = parsed.flatMap((file) => file.keyframes);

const TEXT_INPUT_SELECTOR_RE =
  /(?<=^|[\s,(>+~])input(?=$|[\s,)>+~.#:[])(?![^,:>+~()]*\[type\s*=\s*["']?(?:checkbox|radio|range|file|button|submit|reset)["']?(?:\s+[is])?\s*\])/i;
const TEXTAREA_OR_SELECT_RE = /(?<=^|[\s,(>+~])(?:textarea|select)(?=$|[\s,)>+~.#:[])/;
const CONTENTEDITABLE_RE = /\[contenteditable(?:\s*=\s*(?:"true"|'true'|true|""|''))?\s*\]/i;

function splitTopLevelSelectors(selectors: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: string | null = null;
  for (let i = 0; i < selectors.length; i += 1) {
    const ch = selectors[i];
    if (quote) {
      if (ch === "\\" && i + 1 < selectors.length) i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") parenDepth += 1;
    else if (ch === ")" && parenDepth > 0) parenDepth -= 1;
    else if (ch === "[") bracketDepth += 1;
    else if (ch === "]" && bracketDepth > 0) bracketDepth -= 1;
    else if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
      const part = selectors.slice(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }
  const tail = selectors.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

export function hasTextControlFocus(selectors: string): boolean {
  const parts = splitTopLevelSelectors(selectors);
  return (
    parts.length > 0 &&
    parts.every(
      (selector) =>
        TEXT_INPUT_SELECTOR_RE.test(selector) ||
        TEXTAREA_OR_SELECT_RE.test(selector) ||
        CONTENTEDITABLE_RE.test(selector),
    )
  );
}

function isRuleFocusGated(rule: StyleRule, pseudo: ":focus-visible" | ":focus-within"): boolean {
  return splitTopLevelSelectors(rule.selectors).every((selector) => {
    if (!selector.includes(pseudo)) return true;
    if (selector.includes("[data-keyboard]")) return true;
    if (hasTextControlFocus(selector)) return true;
    if (pseudo === ":focus-visible" && isOutlineResetOnly(rule.body)) return true;
    return false;
  });
}

function isOutlineResetOnly(body: string): boolean {
  const decls = body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
  return decls.length > 0 && decls.every((d) => /^outline\s*:\s*(none|0)\s*$/i.test(d));
}

test("interaction CSS parser finds rules across globals and CSS modules", () => {
  assert.ok(cssFiles.length >= 3, "expected globals.css and CSS modules under src/");
  assert.ok(allRules.some((r) => r.file === "app/globals.css" && r.selectors.includes(".motion-press")));
  assert.ok(allRules.some((r) => r.file === "components/ui/date-picker.module.css" && r.selectors.includes(":hover")));
  assert.ok(allRules.some((r) => r.file === "components/ui/date-picker.module.css" && r.selectors.includes(":focus-visible")));
  assert.ok(allRules.some((r) => r.file === "components/widgets/widget-board.module.css" && r.selectors.includes("data-dragging")));
});

test("custom :hover rules are wrapped in @media (hover: hover)", () => {
  const unguarded = allRules.filter(
    (rule) =>
      rule.selectors.includes(":hover") &&
      !rule.context.some((ctx) => /^@media\s*\(hover:\s*hover\)$/i.test(ctx)),
  );
  assert.deepEqual(
    unguarded.map((r) => `${r.file}: ${r.selectors}`),
    [],
  );
});

test("globals.css gates Tailwind focus-visible variant behind html[data-keyboard]", () => {
  const globals = parsed.find((p) => p.rel === "app/globals.css");
  assert.ok(globals, "globals.css must exist");
  const match = globals.clean.match(/@custom-variant\s+focus-visible\s*\(([\s\S]*?)\)\s*;/);
  assert.ok(match, "globals.css must define @custom-variant focus-visible");
  const variant = match[1];
  assert.ok(variant.includes("html[data-keyboard]"), "focus-visible variant must require html[data-keyboard]");
  assert.ok(variant.includes("input:not("), "focus-visible variant must exempt text inputs");
  assert.ok(variant.includes("textarea"), "focus-visible variant must exempt textarea");
  assert.ok(variant.includes("select"), "focus-visible variant must exempt select");
  assert.ok(variant.includes("contenteditable"), "focus-visible variant must exempt contenteditable");
});

test("custom :focus-visible and :focus-within rules are gated with [data-keyboard]", () => {
  assert.equal(hasTextControlFocus(".select-pill:focus-visible"), false);
  assert.equal(hasTextControlFocus('input[type="checkbox"]:focus-visible'), false);
  assert.equal(hasTextControlFocus('[aria-label="select"]:focus-visible'), false);
  assert.equal(hasTextControlFocus("select:focus-visible, .select-pill:focus-visible"), false);
  assert.equal(hasTextControlFocus('input[type="text"]:focus-visible'), true);
  assert.equal(hasTextControlFocus("textarea:focus-visible"), true);
  assert.equal(hasTextControlFocus("select:focus-visible"), true);

  const badFocusVisible = allRules.filter(
    (rule) =>
      rule.selectors.includes(":focus-visible") &&
      !isRuleFocusGated(rule, ":focus-visible"),
  );
  assert.deepEqual(
    badFocusVisible.map((r) => `${r.file}: ${r.selectors}`),
    [],
  );

  const badFocusWithin = allRules.filter(
    (rule) =>
      rule.selectors.includes(":focus-within") &&
      !isRuleFocusGated(rule, ":focus-within"),
  );
  assert.deepEqual(
    badFocusWithin.map((r) => `${r.file}: ${r.selectors}`),
    [],
  );
});

test("press feedback avoids brightness/filter and restricts :active scaling to primary .motion-press", () => {
  const filterOnActive = allRules.filter(
    (rule) =>
      rule.selectors.includes(":active") &&
      (/\bfilter\s*:/i.test(rule.body) || /\bbrightness\s*\(/i.test(rule.body)),
  );
  assert.deepEqual(
    filterOnActive.map((r) => `${r.file}: ${r.selectors}`),
    [],
  );

  const transformOnActive = allRules.filter((rule) => {
    if (!rule.selectors.includes(":active")) return false;
    const hasSpatial = /\b(scale|transform|translate)\s*:/i.test(rule.body);
    if (!hasSpatial) return false;
    const isReducedNone =
      rule.context.some((ctx) => /^@media\s*\(prefers-reduced-motion:\s*reduce\)$/i.test(ctx)) &&
      /\b(scale|transform|translate)\s*:\s*none\b/i.test(rule.body);
    if (isReducedNone) return false;
    const isPrimaryMotionPress =
      rule.selectors.trim() === '.motion-press:active:not(:disabled, [aria-disabled="true"])' &&
      rule.context.some((ctx) => /^@media\s*\(prefers-reduced-motion:\s*no-preference\)$/i.test(ctx));
    return !isPrimaryMotionPress;
  });
  assert.deepEqual(
    transformOnActive.map((r) => `${r.file}: ${r.selectors}`),
    [],
  );

  const subtleActive = allRules.find(
    (rule) =>
      rule.file === "app/globals.css" &&
      rule.selectors.includes(".motion-press-subtle") &&
      rule.selectors.includes(":active"),
  );
  assert.ok(subtleActive, ".motion-press-subtle:active must exist in globals.css");
  assert.ok(!/\b(scale|transform|translate|filter)\s*:/i.test(subtleActive.body));
});

test("motion animations, DismissibleSheet, Sonner, and accordion honor reduced-motion and platform guards", () => {
  for (const name of ["skeleton-breathe", "card-in"]) {
    const kf = allKeyframes.find((item) => item.name === name);
    assert.ok(kf, `@keyframes ${name} must exist`);
    assert.ok(!/\b(scale|transform|translate)\s*:/i.test(kf.body), `@keyframes ${name} must not scale or translate`);
  }

  for (const target of [
    "@utility skeleton-pulse",
    "@utility motion-data-in",
    "@utility motion-card-in",
    '.refreshIcon[data-refreshing="true"]',
    ".revealSegments",
    ".growBar",
  ]) {
    const matching = allRules.filter((rule) => rule.selectors.includes(target) && /\banimation\s*:/i.test(rule.body));
    assert.ok(matching.length > 0, `expected animation rule for ${target}`);
    for (const rule of matching) {
      assert.ok(
        rule.context.some((ctx) => /^@media\s*\(prefers-reduced-motion:\s*no-preference\)$/i.test(ctx)),
        `${target} animation must sit inside @media (prefers-reduced-motion: no-preference)`,
      );
    }
  }

  const settling = allRules.find(
    (r) => r.file === "app/globals.css" && r.selectors === '[data-sheet-state="settling"]',
  );
  const dismissing = allRules.find(
    (r) => r.file === "app/globals.css" && r.selectors === '[data-sheet-state="dismissing"]',
  );
  assert.ok(settling && settling.body.includes("var(--motion-panel"), "settling sheet must use --motion-panel");
  assert.ok(dismissing && dismissing.body.includes("var(--motion-panel-exit"), "dismissing sheet must use --motion-panel-exit");
  assert.ok(dismissing && /pointer-events\s*:\s*none/i.test(dismissing.body), "dismissing sheet must disable pointer-events");

  const sonnerImportant = allRules.filter(
    (r) =>
      r.file === "app/globals.css" &&
      r.selectors.includes(".cn-toast") &&
      /!important/i.test(r.body),
  );
  assert.deepEqual(
    sonnerImportant.map((r) => `${r.selectors}: ${r.body}`),
    [],
  );

  const accordionHeightRules = allRules.filter(
    (r) =>
      r.file === "app/globals.css" &&
      r.selectors.includes(".atlas-accordion") &&
      r.selectors.includes("::details-content") &&
      (r.body.includes("interpolate-size") || r.body.includes("block-size")),
  );
  assert.ok(accordionHeightRules.length > 0, "expected .atlas-accordion details-content rules");
  for (const rule of accordionHeightRules) {
    assert.ok(
      rule.context.some((ctx) => /^@supports\s*\(interpolate-size:\s*allow-keywords\)$/i.test(ctx)),
      `${rule.selectors} must sit inside @supports (interpolate-size: allow-keywords)`,
    );
  }
});
