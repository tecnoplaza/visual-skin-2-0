// Pure-JS image header parser for PNG / JPEG / WEBP.
// Reads dimensions and format from headers only; does NOT decode pixels.
// Interface intentionally minimal so it can be swapped for a WASM decoder
// (@jsquash/*, wasm-vips, etc.) in the future without touching callers.

export type DetectedImage = {
  format: "png" | "jpeg" | "webp";
  mime: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  pixels: number;
};

export type ImageValidation =
  | { ok: true; image: DetectedImage; warnings: { lowResolution: boolean } }
  | { ok: false; code: ImageErrorCode };

export type ImageErrorCode =
  | "empty_file"
  | "too_large"
  | "unknown_format"
  | "truncated_or_unsupported"
  | "mime_mismatch"
  | "extension_mismatch"
  | "too_small"
  | "dimensions_exceeded"
  | "megapixels_exceeded";

export const IMAGE_LIMITS = {
  MAX_BYTES: 15 * 1024 * 1024,
  MAX_WIDTH: 12000,
  MAX_HEIGHT: 12000,
  MAX_PIXELS: 50_000_000,
  MIN_SIDE: 64,
  LOW_RES_MIN_SIDE: 800,
};

function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}
function u16be(b: Uint8Array, i: number): number {
  return ((b[i] << 8) | b[i + 1]) >>> 0;
}
function u24le(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) >>> 0;
}

function parsePng(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24) return null;
  // 89 50 4E 47 0D 0A 1A 0A + 8 bytes IHDR chunk header (length + type)
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  if (!width || !height) return null;
  return { width, height };
}

function parseJpeg(b: Uint8Array): { width: number; height: number } | null {
  const n = b.length;
  if (n < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  // Safety cap on iterations to avoid pathological loops.
  let steps = 0;
  const MAX_STEPS = 1_000_000;
  while (i < n) {
    if (++steps > MAX_STEPS) return null;
    // Skip fill bytes and locate next marker.
    if (b[i] !== 0xff) return null;
    while (i < n && b[i] === 0xff) i++;
    if (i >= n) return null;
    const marker = b[i]; i++;
    // Standalone markers (no length payload).
    if (marker === 0x00) continue; // stuffed byte, shouldn't occur outside entropy data
    if (marker === 0x01) continue; // TEM
    if (marker >= 0xd0 && marker <= 0xd7) continue; // RST0..RST7
    if (marker === 0xd8) continue; // SOI
    if (marker === 0xd9) return null; // EOI before SOF
    if (marker === 0xda) return null; // SOS before SOF -> unsupported/invalid
    // Segment with length.
    if (i + 2 > n) return null;
    const segLen = u16be(b, i);
    if (segLen < 2) return null;
    if (i + segLen > n) return null; // segment out of buffer
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      // SOF payload: Lf(2) P(1) Y(2) X(2) Nf(1) ...
      if (segLen < 8) return null;
      if (i + 8 > n) return null;
      const height = u16be(b, i + 3);
      const width = u16be(b, i + 5);
      const nf = b[i + 7];
      if (!width || !height) return null;
      if (nf < 1 || nf > 4) return null;
      return { width, height };
    }
    i += segLen;
  }
  return null;
}


function parseWebp(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8 ") {
    // Frame tag at offset 20 (3 bytes), then 3-byte SYNC code (0x9d 0x01 0x2a),
    // then 14-bit width|scale and 14-bit height|scale at offsets 26..29.
    if (b.length < 30) return null;
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const width = (b[26] | (b[27] << 8)) & 0x3fff;
    const height = (b[28] | (b[29] << 8)) & 0x3fff;
    if (!width || !height) return null;
    return { width, height };
  }
  if (fourcc === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const w = ((b[21] | (b[22] << 8)) & 0x3fff) + 1;
    const h = (((b[22] >> 6) | (b[23] << 2) | (b[24] << 10)) & 0x3fff) + 1;
    return { width: w, height: h };
  }
  if (fourcc === "VP8X") {
    if (b.length < 30) return null;
    const width = u24le(b, 24) + 1;
    const height = u24le(b, 27) + 1;
    return { width, height };
  }
  return null;
}

/**
 * Validate an uploaded image using only header bytes.
 * `bytes` is the first slice (>=64 bytes recommended). `totalSize` is the
 * complete file size in bytes. `declaredMime` is what the client sent.
 * `extension` is the storage-path extension (lowercased, no dot).
 */
export function detectAndValidateImage(
  bytes: Uint8Array,
  totalSize: number,
  declaredMime: string,
  extension: string,
): ImageValidation {
  if (totalSize <= 0) return { ok: false, code: "empty_file" };
  if (totalSize > IMAGE_LIMITS.MAX_BYTES) return { ok: false, code: "too_large" };

  let format: "png" | "jpeg" | "webp" | null = null;
  let dims: { width: number; height: number } | null = null;

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    format = "png";
    dims = parsePng(bytes);
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    format = "jpeg";
    dims = parseJpeg(bytes);
  } else if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    format = "webp";
    dims = parseWebp(bytes);
  }

  if (!format) return { ok: false, code: "unknown_format" };
  if (!dims) return { ok: false, code: "truncated_or_unsupported" };

  const mimeOk =
    (format === "png" && declaredMime === "image/png") ||
    (format === "jpeg" && declaredMime === "image/jpeg") ||
    (format === "webp" && declaredMime === "image/webp");
  if (!mimeOk) return { ok: false, code: "mime_mismatch" };

  const extOk =
    (format === "png" && extension === "png") ||
    (format === "jpeg" && (extension === "jpg" || extension === "jpeg")) ||
    (format === "webp" && extension === "webp");
  if (!extOk) return { ok: false, code: "extension_mismatch" };

  const { width, height } = dims;
  if (width < IMAGE_LIMITS.MIN_SIDE || height < IMAGE_LIMITS.MIN_SIDE) {
    return { ok: false, code: "too_small" };
  }
  if (width > IMAGE_LIMITS.MAX_WIDTH || height > IMAGE_LIMITS.MAX_HEIGHT) {
    return { ok: false, code: "dimensions_exceeded" };
  }
  const pixels = width * height;
  if (pixels > IMAGE_LIMITS.MAX_PIXELS) {
    return { ok: false, code: "megapixels_exceeded" };
  }

  const mime: DetectedImage["mime"] =
    format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";

  return {
    ok: true,
    image: { format, mime, width, height, pixels },
    warnings: {
      lowResolution:
        width < IMAGE_LIMITS.LOW_RES_MIN_SIDE || height < IMAGE_LIMITS.LOW_RES_MIN_SIDE,
    },
  };
}
