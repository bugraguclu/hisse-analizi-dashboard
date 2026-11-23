import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { alertInputFromForm, emptyAlertForm, formFromRule, parseDecimalInput, provisionalRule, type AlertRule } from "./model.ts";
import { deviceRequest, DeviceApiError } from "../device/device-api.ts";
import { generateDeviceKey, getOrCreateDeviceKey, isValidDeviceKey, DEVICE_KEY_STORAGE_KEY } from "../device/device-key.ts";
import { createMemoryStorage } from "../local-store/storage.ts";

describe("alert form", () => {
  test("parses Turkish and English decimals", () => {
    assert.equal(parseDecimalInput("312,50"), 312.5);
    assert.equal(parseDecimalInput("1.234,5"), 1234.5);
    assert.equal(parseDecimalInput("312.5"), 312.5);
    assert.equal(parseDecimalInput(" 1 234,5 "), 1234.5);
    assert.equal(parseDecimalInput("12a"), null);
    assert.equal(parseDecimalInput(""), null);
  });

  test("builds per-kind bodies and rejects invalid thresholds", () => {
    const price = alertInputFromForm({ ...emptyAlertForm("thyao"), threshold: "300", rearm: true });
    assert.deepEqual(price, {
      ok: true,
      input: { ticker: "THYAO", kind: "price_above", hysteresis_pct: 1, enabled: true, threshold: 300, direction: null, repeat: "rearm", min_severity: null },
    });
    assert.deepEqual(alertInputFromForm({ ...emptyAlertForm("THYAO"), threshold: "0" }), { ok: false, error: "threshold-price" });
    assert.deepEqual(alertInputFromForm({ ...emptyAlertForm("X"), threshold: "1" }), { ok: false, error: "ticker" });
    assert.deepEqual(alertInputFromForm({ ...emptyAlertForm("GARAN", "change_pct"), threshold: "60" }), { ok: false, error: "threshold-change" });
    const kap = alertInputFromForm({ ...emptyAlertForm("GARAN", "kap"), minSeverity: "HIGH", threshold: "999" });
    assert.ok(kap.ok && kap.input.threshold === null && kap.input.min_severity === "HIGH");
  });

  test("round-trips a stored rule and builds an optimistic copy", () => {
    const rule: AlertRule = {
      id: "r1", ticker: "THYAO", kind: "price_below", threshold: 290.5, direction: null, repeat: "once", hysteresis_pct: 1,
      min_severity: null, enabled: true, state: "armed", trigger_count: 0, last_triggered_at: null, version: 3,
      created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
    };
    const form = formFromRule(rule);
    assert.equal(form.threshold, "290,5");
    const parsed = alertInputFromForm(form);
    assert.ok(parsed.ok);
    const copy = provisionalRule("r1", parsed.input, rule, "2026-11-02T00:00:00Z");
    assert.equal(copy.version, 3, "keeps the base version until the server answers");
    assert.equal(copy.state, "pending");
  });
});

describe("device key", () => {
  test("is 43 base64url characters and persists once", () => {
    const key = generateDeviceKey();
    assert.ok(isValidDeviceKey(key));
    const storage = createMemoryStorage();
    const first = getOrCreateDeviceKey(storage);
    assert.equal(getOrCreateDeviceKey(storage), first);
    assert.equal(storage.getItem(DEVICE_KEY_STORAGE_KEY), first);
    assert.equal(getOrCreateDeviceKey(null), null);
  });
});

describe("device API errors", () => {
  test("distinguishes transient failures from rejections", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await assert.rejects(deviceRequest("/me/notes", {}, offline), (error: DeviceApiError) => error.status === null && error.transient);

    const conflict = (async () =>
      new Response(JSON.stringify({ detail: "Değişti", code: "version_conflict", current: { version: 4 } }), { status: 409 })) as unknown as typeof fetch;
    await assert.rejects(deviceRequest("/me/notes/THYAO", { method: "PUT", body: {} }, conflict), (error: DeviceApiError) => {
      assert.equal(error.code, "version_conflict");
      assert.equal(error.transient, false);
      assert.deepEqual((error.body as { current: unknown }).current, { version: 4 });
      return true;
    });

    const busy = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    await assert.rejects(deviceRequest("/me/notes", {}, busy), (error: DeviceApiError) => error.transient);
  });
});
