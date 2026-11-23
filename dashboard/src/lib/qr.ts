/** QR matrices for local pairing links, encoded by the maintained QR implementation. */
import qrcode from "qrcode-generator";

export interface QrMatrix {
  version: number;
  size: number;
  modules: boolean[][];
}

qrcode.stringToBytes = (text) => Array.from(new TextEncoder().encode(text));

/** Byte mode, error correction M; limit to version 10 for readable pairing codes. */
export function encodeQr(text: string): QrMatrix {
  if (new TextEncoder().encode(text).byteLength > 213) {
    throw new RangeError("QR payload exceeds version 10 capacity");
  }
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  return {
    version: (size - 17) / 4,
    size,
    modules: Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => qr.isDark(row, col))),
  };
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
