import { sha256 as sha256Streaming } from "js-sha256";

export type CropArea = { x: number; y: number; width: number; height: number };

export type CropOutputOptions = {
  outputSize: number;
  mimeType?: "image/jpeg" | "image/webp";
  quality?: number;
};

// 256 KB. Below this we feed the bytes to crypto.subtle.digest in one shot
// (a few-hundred-KB buffer is fine in any browser). Above it, we route through
// js-sha256's incremental hasher so we never materialize the whole Blob in JS heap.
const STREAM_HASH_THRESHOLD_BYTES = 256 * 1024;

export async function cropImageToBlob(
  src: string,
  area: CropArea,
  opts: CropOutputOptions,
): Promise<Blob> {
  const image = await loadImage(src);
  const { outputSize, mimeType = "image/jpeg", quality = 0.85 } = opts;

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("crop: 2d context unavailable");

  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, outputSize, outputSize);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mimeType, quality),
  );
  if (!blob) throw new Error("crop: canvas.toBlob returned null");
  return blob;
}

export async function sha256Hex(input: ArrayBuffer | Blob): Promise<string> {
  if (input instanceof ArrayBuffer) {
    return digestArrayBuffer(input);
  }
  if (input.size <= STREAM_HASH_THRESHOLD_BYTES) {
    return digestArrayBuffer(await input.arrayBuffer());
  }
  return digestBlobStreaming(input);
}

async function digestArrayBuffer(buf: ArrayBuffer): Promise<string> {
  const out = await crypto.subtle.digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(out));
}

async function digestBlobStreaming(blob: Blob): Promise<string> {
  const hasher = sha256Streaming.create();
  const reader = blob.stream().getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  return hasher.hex();
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("crop: failed to load image"));
    img.src = src;
  });
}
