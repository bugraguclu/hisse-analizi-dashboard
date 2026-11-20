import assert from "node:assert/strict";
import test from "node:test";
import jsQR from "jsqr";
import { encodeQr, qrToSvgPath } from "./qr.ts";

test("independent reader decodes pairing links, UTF-8 and every supported QR version", () => {
  const payloads = [
    "hisseanalizi://pair?server=https%3A%2F%2Fhisseanalizi.com&code=ABCD2345",
    "Türkçe-şirket-İŞ",
    ...[8, 20, 40, 60, 70, 95, 115, 140, 170, 200].map((length) => "x".repeat(length)),
  ];
  const versions = new Set<number>();
  for (const payload of payloads) {
    const qr = encodeQr(payload);
    versions.add(qr.version);
    const scale = 4;
    const size = (qr.size + 8) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!qr.modules[Math.floor(y / scale) - 4]?.[Math.floor(x / scale) - 4]) continue;
        const offset = (y * size + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
    assert.equal(jsQR(pixels, size, size)?.data, payload, `Cannot decode version ${qr.version}`);
  }
  assert.equal(versions.size, 10);
});

test("encodeQr generates valid Version 1 matrix for short payload", () => {
  const qr = encodeQr("ABCD2345");
  assert.equal(qr.version, 1);
  assert.equal(qr.size, 21);
  assert.equal(qr.modules.length, 21);
  assert.ok(qr.modules.every((row) => row.length === 21));

  // Top-left finder outer border (0,0..6) must be dark
  for (let i = 0; i < 7; i++) {
    assert.equal(qr.modules[0][i], true);
    assert.equal(qr.modules[6][i], true);
    assert.equal(qr.modules[i][0], true);
    assert.equal(qr.modules[i][6], true);
  }
  // Center 3x3 of top-left finder must be dark
  for (let r = 2; r <= 4; r++) {
    for (let c = 2; c <= 4; c++) {
      assert.equal(qr.modules[r][c], true);
    }
  }
  // Separator ring around top-left finder must be light
  for (let i = 0; i < 8; i++) {
    assert.equal(qr.modules[7][i], false);
    assert.equal(qr.modules[i][7], false);
  }
});

test("encodeQr encodes hisseanalizi pairing URLs deterministically", () => {
  const url = "hisseanalizi://pair?server=https%3A%2F%2Fhisse.example.com&code=ABCD2345";
  const a = encodeQr(url);
  const b = encodeQr(url);
  assert.equal(a.version, b.version);
  assert.equal(a.size, b.size);
  assert.deepEqual(a.modules, b.modules);
  assert.ok(a.version >= 4 && a.version <= 10);

  const svg = qrToSvgPath(a, 4);
  assert.equal(svg.viewBoxSize, a.size + 8);
  assert.ok(svg.path.startsWith("M"));
  assert.ok(svg.path.includes("z"));
});

test("encodeQr rejects payloads exceeding Version 10 capacity", () => {
  assert.throws(() => encodeQr("A".repeat(250)), RangeError);
});
