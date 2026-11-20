#!/usr/bin/env node
/**
 * Native iOS configuration verifier for Hisse Analizi (does not compile or sign an app).
 *
 * Adapted from TusAnkiM's `scripts/verify-ios-readiness.mjs`, supporting both
 * Expo (`mobile/app.json` or `app.json`) and native Xcode (`ios/`) targets.
 *
 * Usage:
 *   node scripts/verify-ios-readiness.mjs                    # verifies native target if present, else contract
 *   node scripts/verify-ios-readiness.mjs --require-native   # fails if native iOS target is absent
 *   node scripts/verify-ios-readiness.mjs --ios-dir <dir>    # verify a specific native iOS directory
 *   node scripts/verify-ios-readiness.mjs --app-config <p>   # verify a specific Expo app.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONTRACT_PATH = path.join(DEFAULT_ROOT, "scripts", "ios-release-contract.json");

function plistStringValue(contents, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = contents.match(new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*<string>([^<]*)</string>`));
  return match ? match[1].trim() : null;
}

function plistBooleanValue(contents, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = contents.match(new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*<(true|false)\\s*/>`));
  if (!match) return null;
  return match[1] === "true";
}

export function loadIosReleaseContract(contractPath = DEFAULT_CONTRACT_PATH) {
  const raw = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  if (raw?.schemaVersion !== 1) {
    throw new Error(`Unsupported ios-release-contract schemaVersion: ${raw?.schemaVersion}`);
  }
  return raw;
}

function verifyContractShape(contract, failures) {
  const requireVal = (cond, msg) => {
    if (!cond) failures.push(msg);
  };
  requireVal(contract?.schemaVersion === 1, "iOS release contract must use schemaVersion 1");
  requireVal(typeof contract?.bundleIdentifierPattern === "string" && contract.bundleIdentifierPattern.length > 0, "Contract missing bundleIdentifierPattern");
  requireVal(Array.isArray(contract?.requiredUrlSchemes) && contract.requiredUrlSchemes.length > 0, "Contract must declare at least one URL scheme");
  requireVal(contract?.requirePrivacyManifest === true, "Contract must enforce PrivacyInfo.xcprivacy / privacyManifests");
  requireVal(contract?.requireNoArbitraryLoads === true, "Contract must enforce ATS (NSAllowsArbitraryLoads = false)");
}

function verifyExpoConfig(configPath, contract, failures) {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const app = parsed?.expo ?? parsed;
  const bundleRe = new RegExp(contract.bundleIdentifierPattern);
  const requireVal = (cond, msg) => {
    if (!cond) failures.push(`[app.json] ${msg}`);
  };

  requireVal(typeof app?.ios?.bundleIdentifier === "string" && bundleRe.test(app.ios.bundleIdentifier), "Missing or invalid ios.bundleIdentifier");
  requireVal(typeof app?.ios?.buildNumber === "string" && app.ios.buildNumber.trim().length > 0, "Missing ios.buildNumber");

  if (contract.requireNonExemptEncryptionFalse) {
    requireVal(app?.ios?.config?.usesNonExemptEncryption === false, "ios.config.usesNonExemptEncryption must be explicitly false");
  }
  if (contract.requirePrivacyManifest) {
    requireVal(
      typeof app?.ios?.privacyManifests?.NSPrivacyTracking === "boolean",
      "ios.privacyManifests.NSPrivacyTracking must be explicitly declared",
    );
  }
  if (contract.requireDarkModeAutomatic) {
    requireVal(app?.userInterfaceStyle === "automatic", 'userInterfaceStyle must be "automatic" while dark mode ships');
  }
  if (contract.requireNoArbitraryLoads) {
    requireVal(
      app?.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false,
      "NSAppTransportSecurity.NSAllowsArbitraryLoads must be false",
    );
  }
  if (contract.requireNoLocalNetworking) {
    requireVal(
      app?.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsLocalNetworking === false,
      "NSAppTransportSecurity.NSAllowsLocalNetworking must be false",
    );
  }
  if (contract.requireCompleteDataProtection) {
    requireVal(
      app?.ios?.entitlements?.["com.apple.developer.default-data-protection"] === "NSFileProtectionComplete",
      "ios.entitlements must enable NSFileProtectionComplete",
    );
  }
  if (contract.requireAssociatedDomains) {
    const domains = app?.ios?.associatedDomains;
    requireVal(
      Array.isArray(domains) && domains.some((d) => typeof d === "string" && d.startsWith("applinks:")),
      "ios.associatedDomains must include at least one applinks: entry",
    );
  }

  const schemes = Array.isArray(app?.scheme) ? app.scheme : typeof app?.scheme === "string" ? [app.scheme] : [];
  for (const requiredScheme of contract.requiredUrlSchemes ?? []) {
    requireVal(schemes.includes(requiredScheme), `Missing required URL scheme "${requiredScheme}"`);
  }

  if (contract.requireNotificationConfig) {
    const plugins = (app?.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    const hasNotificationSetting =
      plugins.includes("expo-notifications") ||
      typeof app?.ios?.entitlements?.["aps-environment"] === "string";
    requireVal(hasNotificationSetting, "Missing notification configuration (expo-notifications plugin or aps-environment entitlement)");
  }
}

const APP_INFO_PLIST_NAMES = ["Info.plist", "App-Info.plist"];

function findInfoPlistInDir(dir) {
  return APP_INFO_PLIST_NAMES.find((name) => fs.existsSync(path.join(dir, name))) ?? null;
}

function findNativeAppTarget(iosDir) {
  if (!fs.existsSync(iosDir)) return null;
  const direct = findInfoPlistInDir(iosDir);
  if (direct) return { appDir: iosDir, infoPlistName: direct };
  for (const entry of fs.readdirSync(iosDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "Pods" || entry.name === "build") continue;
    const candidate = path.join(iosDir, entry.name);
    const found = findInfoPlistInDir(candidate);
    if (found) return { appDir: candidate, infoPlistName: found };
  }
  return null;
}

function verifyNativeIosDir(iosDir, contract, failures) {
  const target = findNativeAppTarget(iosDir);
  const requireVal = (cond, msg) => {
    if (!cond) failures.push(`[ios] ${msg}`);
  };
  requireVal(Boolean(target), `Native iOS directory (${iosDir}) is missing Info.plist`);
  if (!target) return;

  const { appDir, infoPlistName } = target;
  const infoPlist = fs.readFileSync(path.join(appDir, infoPlistName), "utf8");
  const bundleRe = new RegExp(contract.bundleIdentifierPattern);

  const bundleId = plistStringValue(infoPlist, "CFBundleIdentifier");
  requireVal(
    Boolean(bundleId) && (bundleId.includes("$(PRODUCT_BUNDLE_IDENTIFIER)") || bundleRe.test(bundleId)),
    "Info.plist is missing a valid CFBundleIdentifier",
  );
  const buildVersion = plistStringValue(infoPlist, "CFBundleVersion");
  requireVal(Boolean(buildVersion), "Info.plist is missing CFBundleVersion");

  if (contract.requireDarkModeAutomatic) {
    requireVal(
      plistStringValue(infoPlist, "UIUserInterfaceStyle") !== "Light",
      "Info.plist must not force UIUserInterfaceStyle = Light while dark mode ships",
    );
  }
  if (contract.requireNonExemptEncryptionFalse) {
    requireVal(
      plistBooleanValue(infoPlist, "ITSAppUsesNonExemptEncryption") === false,
      "Info.plist must set ITSAppUsesNonExemptEncryption = false",
    );
  }
  if (contract.requireNoArbitraryLoads) {
    requireVal(
      plistBooleanValue(infoPlist, "NSAllowsArbitraryLoads") === false,
      "Info.plist must disable NSAllowsArbitraryLoads",
    );
  }
  if (contract.requireNoLocalNetworking) {
    requireVal(
      plistBooleanValue(infoPlist, "NSAllowsLocalNetworking") === false,
      "Info.plist must disable NSAllowsLocalNetworking",
    );
  }

  for (const requiredScheme of contract.requiredUrlSchemes ?? []) {
    requireVal(
      infoPlist.includes(`<string>${requiredScheme}</string>`),
      `Info.plist CFBundleURLTypes is missing URL scheme "${requiredScheme}"`,
    );
  }

  if (contract.requirePrivacyManifest) {
    const privacyPath = path.join(appDir, "PrivacyInfo.xcprivacy");
    const hasPrivacy = fs.existsSync(privacyPath);
    requireVal(hasPrivacy, "Missing PrivacyInfo.xcprivacy privacy manifest");
    if (hasPrivacy) {
      const privacyXml = fs.readFileSync(privacyPath, "utf8");
      requireVal(
        plistBooleanValue(privacyXml, "NSPrivacyTracking") !== null,
        "PrivacyInfo.xcprivacy must explicitly declare NSPrivacyTracking",
      );
    }
  }

  const entitlementFiles = fs.readdirSync(appDir).filter((name) => name.endsWith(".entitlements"));
  const entitlementName =
    entitlementFiles.find((name) => name === "App.entitlements") ??
    entitlementFiles.find((name) => !name.toLowerCase().includes("widget")) ??
    entitlementFiles[0];
  requireVal(Boolean(entitlementName), "Missing .entitlements file in native iOS app target");
  if (entitlementName) {
    const entitlements = fs.readFileSync(path.join(appDir, entitlementName), "utf8");
    if (contract.requireCompleteDataProtection) {
      requireVal(
        plistStringValue(entitlements, "com.apple.developer.default-data-protection") === "NSFileProtectionComplete",
        "Entitlements must enable NSFileProtectionComplete",
      );
    }
    if (contract.requireAssociatedDomains) {
      requireVal(
        entitlements.includes("<key>com.apple.developer.associated-domains</key>") && entitlements.includes("applinks:"),
        "Entitlements must declare com.apple.developer.associated-domains with applinks:",
      );
    }
    if (contract.requireNotificationConfig) {
      requireVal(
        Boolean(plistStringValue(entitlements, "aps-environment")) ||
          infoPlist.includes("NSUserNotificationsUsageDescription") ||
          infoPlist.includes("UIBackgroundModes"),
        "Missing notification configuration (aps-environment entitlement or notification usage declaration)",
      );
    }
  }
}

export function verifyIosReadiness({
  projectRoot = DEFAULT_ROOT,
  appConfigPath,
  iosDir,
  contract = loadIosReleaseContract(),
  requireNative = false,
} = {}) {
  const failures = [];
  const warnings = [];
  const checkedTargets = [];

  verifyContractShape(contract, failures);

  const resolvedAppConfig =
    appConfigPath ??
    [path.join(projectRoot, "mobile", "app.json"), path.join(projectRoot, "app.json")].find((candidate) =>
      fs.existsSync(candidate),
    ) ??
    null;

  const resolvedIosDir =
    iosDir ??
    [path.join(projectRoot, "mobile", "ios"), path.join(projectRoot, "ios")].find((candidate) =>
      fs.existsSync(candidate) && findNativeAppTarget(candidate),
    ) ??
    null;

  if (resolvedAppConfig && fs.existsSync(resolvedAppConfig)) {
    checkedTargets.push(path.relative(projectRoot, resolvedAppConfig) || resolvedAppConfig);
    verifyExpoConfig(resolvedAppConfig, contract, failures);
  }
  if (resolvedIosDir && fs.existsSync(resolvedIosDir)) {
    checkedTargets.push(path.relative(projectRoot, resolvedIosDir) || resolvedIosDir);
    verifyNativeIosDir(resolvedIosDir, contract, failures);
  }

  if (checkedTargets.length === 0) {
    const msg = "No native iOS project (ios/ or mobile/app.json) found yet; verified release contract baseline only.";
    if (requireNative) failures.push(msg);
    else warnings.push(msg);
  }

  return { ok: failures.length === 0, failures, warnings, checkedTargets };
}

function parseArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyIosReadiness({
    requireNative: process.argv.includes("--require-native"),
    iosDir: parseArg("--ios-dir"),
    appConfigPath: parseArg("--app-config"),
  });

  for (const warning of result.warnings) console.warn(`[WARN] ${warning}`);
  if (!result.ok) {
    console.error("iOS configuration check failed:");
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    result.checkedTargets.length > 0
      ? `iOS configuration verified (${result.checkedTargets.join(", ")}); native build and device tests are separate.`
      : "iOS release contract verified (web-only repository; pass --require-native once ios/ lands).",
  );
}
