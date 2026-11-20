/**
 * Zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, EC level M, Versions 1–10).
 *
 * Encodes UTF-8 strings up to 213 bytes — plenty for `hisseanalizi://pair?server=...&code=...`
 * deep links — and renders a single crisp SVG `<path>` with a 4-module quiet zone.
 */

export interface QrMatrix {
  version: number;
  size: number;
  modules: boolean[][];
}

interface VersionSpec {
  version: number;
  /** Maximum data codewords for Error Correction Level M. */
  dataCodewords: number;
  /** Error correction codewords per block (EC level M). */
  ecPerBlock: number;
  /** Number of RS blocks in group 1 and group 2. */
  blocks: readonly (readonly [count: number, dataLen: number])[];
  /** Alignment pattern center coordinates (empty for version 1). */
  alignment: readonly number[];
}

// ISO/IEC 18004 Table 9 (Error Correction Level M, Versions 1..10)
const VERSION_SPECS: readonly VersionSpec[] = [
  { version: 1, dataCodewords: 16, ecPerBlock: 10, blocks: [[1, 16]], alignment: [] },
  { version: 2, dataCodewords: 28, ecPerBlock: 16, blocks: [[1, 28]], alignment: [6, 18] },
  { version: 3, dataCodewords: 44, ecPerBlock: 26, blocks: [[1, 44]], alignment: [6, 22] },
  { version: 4, dataCodewords: 64, ecPerBlock: 18, blocks: [[2, 32]], alignment: [6, 26] },
  { version: 5, dataCodewords: 86, ecPerBlock: 24, blocks: [[2, 43]], alignment: [6, 30] },
  { version: 6, dataCodewords: 108, ecPerBlock: 16, blocks: [[4, 27]], alignment: [6, 34] },
  { version: 7, dataCodewords: 124, ecPerBlock: 18, blocks: [[4, 31]], alignment: [6, 22, 38] },
  { version: 8, dataCodewords: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]], alignment: [6, 24, 42] },
  { version: 9, dataCodewords: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]], alignment: [6, 26, 46] },
  { version: 10, dataCodewords: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]], alignment: [6, 28, 50] },
];

// Version information bitstrings for versions 7..10 (18-bit BCH(18,6)).
const VERSION_INFO: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

// Precomputed GF(256) exp/log tables with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGenerator(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    for (let j = 0; j < ecCount; j++) {
      rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

function selectSpec(byteLength: number): VersionSpec {
  for (const spec of VERSION_SPECS) {
    // 4-bit mode indicator + (8 or 16)-bit length + payload bytes
    const countBits = spec.version >= 10 ? 16 : 8;
    const neededBits = 4 + countBits + byteLength * 8;
    if (neededBits <= spec.dataCodewords * 8) {
      return spec;
    }
  }
  throw new RangeError(`QR payload too long (${byteLength} bytes; max 213 bytes).`);
}

function buildCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const bits: number[] = [];
  const pushBits = (val: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode (0100)
  pushBits(0b0100, 4);
  pushBits(bytes.length, spec.version >= 10 ? 16 : 8);
  for (const b of bytes) pushBits(b, 8);

  const capacityBits = spec.dataCodewords * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  pushBits(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(spec.dataCodewords);
  let idx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data[idx++] = byte;
  }
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (idx < spec.dataCodewords) {
    data[idx++] = padBytes[padIdx % 2];
    padIdx++;
  }

  // Split into RS blocks & interleave
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const [count, len] of spec.blocks) {
    for (let b = 0; b < count; b++) {
      const slice = data.subarray(offset, offset + len);
      offset += len;
      dataBlocks.push(slice);
      ecBlocks.push(rsRemainder(slice, spec.ecPerBlock));
    }
  }

  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  const totalLen = spec.dataCodewords + ecBlocks.length * spec.ecPerBlock;
  const out = new Uint8Array(totalLen);
  let outIdx = 0;
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) out[outIdx++] = block[i];
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) {
      out[outIdx++] = block[i];
    }
  }
  return out;
}

function formatBitsForMask(mask: number): number {
  // EC Level M = 00; 5-bit data = (0b00 << 3) | mask
  const data = mask & 0x7;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function placeFunctionPatterns(spec: VersionSpec): { modules: boolean[][]; isFunction: boolean[][] } {
  const size = spec.version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const setFn = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = dark;
    isFunction[r][c] = true;
  };

  // Finder patterns + separators
  const drawFinder = (top: number, left: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const r = top + dy;
        const c = left + dx;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const dist = Math.max(Math.abs(dy - 3), Math.abs(dx - 3));
        const dark = dist !== 2 && dist !== 4;
        setFn(r, c, dark);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const centers = spec.alignment;
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0)) {
        continue;
      }
      const cr = centers[i];
      const cc = centers[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const dist = Math.max(Math.abs(dy), Math.abs(dx));
          setFn(cr + dy, cc + dx, dist !== 1);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i <= 8; i++) {
    setFn(8, i, false);
    setFn(i, 8, false);
  }
  for (let i = size - 8; i < size; i++) {
    setFn(8, i, false);
    setFn(i, 8, false);
  }
  setFn(size - 8, 8, true);

  // Version info for versions >= 7
  const vInfo = VERSION_INFO[spec.version];
  if (vInfo !== undefined) {
    for (let i = 0; i < 18; i++) {
      const bit = ((vInfo >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  return { modules, isFunction };
}

function writeFormatInfo(modules: boolean[][], mask: number): void {
  const size = modules.length;
  const bits = formatBitsForMask(mask);
  for (let i = 0; i <= 5; i++) modules[8][i] = ((bits >>> i) & 1) === 1;
  modules[8][7] = ((bits >>> 6) & 1) === 1;
  modules[8][8] = ((bits >>> 7) & 1) === 1;
  modules[7][8] = ((bits >>> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) modules[14 - i][8] = ((bits >>> i) & 1) === 1;

  for (let i = 0; i < 8; i++) modules[size - 1 - i][8] = ((bits >>> i) & 1) === 1;
  for (let i = 8; i < 15; i++) modules[8][size - 15 + i] = ((bits >>> i) & 1) === 1;
  modules[size - 8][8] = true;
}

function placeDataBits(modules: boolean[][], isFunction: boolean[][], codewords: Uint8Array): void {
  const size = modules.length;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (isFunction[r][c]) continue;
        let dark = false;
        if (bitIdx < totalBits) {
          dark = ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        }
        modules[r][c] = dark;
      }
    }
  }
}

function penaltyScore(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;

  // Rule 1: runs of 5+ same-color modules
  for (let r = 0; r < size; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const color = modules[r][c];
      if (color === modules[r][c + 1] && color === modules[r + 1][c] && color === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 4: dark module balance
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) darkCount++;
    }
  }
  const k = Math.floor(Math.abs((darkCount * 20) / (size * size) - 10));
  score += k * 10;
  return score;
}

/** Encode a UTF-8 string into a standard QR Code boolean matrix (EC level M). */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const spec = selectSpec(bytes.length);
  const codewords = buildCodewords(bytes, spec);
  const { modules: base, isFunction } = placeFunctionPatterns(spec);
  placeDataBits(base, isFunction, codewords);

  const size = base.length;
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestModules = base;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = base.map((row, r) =>
      row.map((val, c) => (isFunction[r][c] ? val : val !== maskBit(mask, r, c))),
    );
    writeFormatInfo(candidate, mask);
    const score = penaltyScore(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  writeFormatInfo(bestModules, bestMask);
  return { version: spec.version, size, modules: bestModules };
}

/** Convert a QR matrix into an SVG path string with `margin` quiet-zone modules. */
export function qrToSvgPath(matrix: QrMatrix, margin = 4): { viewBoxSize: number; path: string } {
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r++) {
    let c = 0;
    while (c < matrix.size) {
      if (!matrix.modules[r][c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < matrix.size && matrix.modules[r][c]) c++;
      const width = c - start;
      parts.push(`M${start + margin},${r + margin}h${width}v1h-${width}z`);
    }
  }
  return {
    viewBoxSize: matrix.size + margin * 2,
    path: parts.join(""),
  };
}
