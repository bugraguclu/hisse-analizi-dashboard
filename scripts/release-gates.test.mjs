import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { BUNDLE_BUDGET_CONFIG } from "./bundle-budgets.config.mjs";
import { checkBundleBudgets } from "./check-bundle-budgets.mjs";
import { loadIosReleaseContract, verifyIosReadiness } from "./verify-ios-readiness.mjs";

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("bundle budget release gate", () => {
  it("reports which JS chunk exceeded the single-chunk budget", () => {
    const tmp = makeTempDir("hisse-budget-");
    try {
      const chunksDir = path.join(tmp, "dashboard", ".next", "static", "chunks");
      fs.mkdirSync(chunksDir, { recursive: true });
      // Write a chunk deliberately over the single-chunk budget (700 KiB).
      const bigChunk = path.join(chunksDir, "oversized-chart-widget.js");
      fs.writeFileSync(bigChunk, "a".repeat(700 * 1024));

      const result = checkBundleBudgets({ rootDir: tmp, includeWeb: true, config: BUNDLE_BUDGET_CONFIG });
      assert.equal(result.ok, false);
      assert.ok(
        result.violations.some((msg) => msg.includes("oversized-chart-widget.js")),
        `expected offending chunk name in violations: ${result.violations.join("; ")}`,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("blocks forbidden secret files in public/", () => {
    const tmp = makeTempDir("hisse-forbidden-");
    try {
      const pubDir = path.join(tmp, "dashboard", "public");
      fs.mkdirSync(pubDir, { recursive: true });
      fs.writeFileSync(path.join(pubDir, "leaked.pem"), "SECRET");

      const result = checkBundleBudgets({ rootDir: tmp, includeWeb: false, config: BUNDLE_BUDGET_CONFIG });
      assert.equal(result.ok, false);
      assert.ok(result.violations.some((msg) => msg.includes("leaked.pem")));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("native iOS release readiness gate", () => {
  it("passes on a compliant Expo + native iOS target", () => {
    const tmp = makeTempDir("hisse-ios-ok-");
    try {
      const mobileDir = path.join(tmp, "mobile");
      const iosAppDir = path.join(tmp, "ios", "HisseAnalizi");
      fs.mkdirSync(mobileDir, { recursive: true });
      fs.mkdirSync(iosAppDir, { recursive: true });

      fs.writeFileSync(
        path.join(mobileDir, "app.json"),
        JSON.stringify({
          expo: {
            scheme: "hisseanalizi",
            userInterfaceStyle: "automatic",
            plugins: ["expo-router", "expo-notifications"],
            ios: {
              bundleIdentifier: "com.hisseanalizi.app",
              buildNumber: "1",
              associatedDomains: ["applinks:hisseanalizi.com"],
              config: { usesNonExemptEncryption: false },
              privacyManifests: { NSPrivacyTracking: false },
              entitlements: {
                "com.apple.developer.default-data-protection": "NSFileProtectionComplete",
              },
              infoPlist: {
                NSAppTransportSecurity: {
                  NSAllowsArbitraryLoads: false,
                  NSAllowsLocalNetworking: false,
                },
              },
            },
          },
        }),
      );

      fs.writeFileSync(
        path.join(iosAppDir, "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.hisseanalizi.app</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsArbitraryLoads</key><false/>
    <key>NSAllowsLocalNetworking</key><false/>
  </dict>
  <key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>hisseanalizi</string></array></dict></array>
</dict></plist>`,
      );
      fs.writeFileSync(
        path.join(iosAppDir, "PrivacyInfo.xcprivacy"),
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>NSPrivacyTracking</key><false/></dict></plist>`,
      );
      fs.writeFileSync(
        path.join(iosAppDir, "HisseAnalizi.entitlements"),
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
  <key>com.apple.developer.default-data-protection</key><string>NSFileProtectionComplete</string>
  <key>com.apple.developer.associated-domains</key><array><string>applinks:hisseanalizi.com</string></array>
  <key>aps-environment</key><string>production</string>
</dict></plist>`,
      );

      const result = verifyIosReadiness({
        projectRoot: tmp,
        contract: loadIosReleaseContract(),
        requireNative: true,
      });
      assert.equal(result.ok, true, `unexpected failures: ${result.failures.join("; ")}`);
      assert.equal(result.checkedTargets.length, 2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails with specific errors when mandatory iOS settings are missing or unsafe", () => {
    const tmp = makeTempDir("hisse-ios-bad-");
    try {
      const mobileDir = path.join(tmp, "mobile");
      fs.mkdirSync(mobileDir, { recursive: true });
      fs.writeFileSync(
        path.join(mobileDir, "app.json"),
        JSON.stringify({
          expo: {
            userInterfaceStyle: "light",
            ios: {
              bundleIdentifier: "invalid",
              infoPlist: { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } },
            },
          },
        }),
      );

      const result = verifyIosReadiness({
        projectRoot: tmp,
        contract: loadIosReleaseContract(),
        requireNative: true,
      });
      assert.equal(result.ok, false);
      assert.ok(result.failures.some((m) => m.includes("bundleIdentifier")));
      assert.ok(result.failures.some((m) => m.includes("buildNumber")));
      assert.ok(result.failures.some((m) => m.includes("NSPrivacyTracking")));
      assert.ok(result.failures.some((m) => m.includes("NSAllowsArbitraryLoads")));
      assert.ok(result.failures.some((m) => m.includes("URL scheme")));
      assert.ok(result.failures.some((m) => m.includes("notification")));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
