import assert from "node:assert/strict";
import test from "node:test";
import { buildPairingLink, formatPairingCode, isPairingExpired } from "./widget-pairing.ts";

test("formatPairingCode inserts hyphen in 8-char code", () => {
  assert.equal(formatPairingCode("abcd2345"), "ABCD-2345");
  assert.equal(formatPairingCode("ab cd-2345"), "ABCD-2345");
});

test("buildPairingLink URL-encodes origin and strips trailing slash", () => {
  const link = buildPairingLink("https://hisse.example.com/", "abcd-2345");
  assert.equal(
    link,
    "hisseanalizi://pair?server=https%3A%2F%2Fhisse.example.com&code=ABCD2345",
  );
});

test("isPairingExpired detects expired and valid timestamps", () => {
  const now = Date.parse("2026-11-20T10:00:00Z");
  assert.equal(isPairingExpired("2026-11-20T10:10:00Z", now), false);
  assert.equal(isPairingExpired("2026-11-20T10:00:00Z", now), true);
  assert.equal(isPairingExpired("2026-11-20T09:59:00Z", now), true);
  assert.equal(isPairingExpired("not-a-date", now), true);
});
