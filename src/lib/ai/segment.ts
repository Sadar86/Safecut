"use client";

/**
 * Background removal with a portrait-segmentation model (MODNet) running locally
 * through transformers.js.
 *
 * The output is an *alpha matte* for a sampled frame; the editor stores the
 * background choice on the clip and the renderer composites it, so the original
 * media is never modified. Frames are processed on demand (sampled), because a
 * full per-frame matte for long clips is far too slow in a browser tab.
 */

import type { ModelProgress } from "@/lib/ai/models";

type Segmenter = (input: unknown, options?: Record<string, unknown>) => Promise<{
  toCanvas?: () => Promise<HTMLCanvasElement>;
  [index: number]: { data: Uint8Array | Float32Array; dims?: number[] };
}>;

interface RawImageLike {
  fromCanvas: (canvas: HTMLCanvasElement) => unknown;
}
interface TransformersModule {
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<Segmenter>;
  RawImage: RawImageLike;
}

let modulePromise: Promise<TransformersModule> | null = null;
let segmenterPromise: Promise<Segmenter> | null = null;

async function loadTransformers(): Promise<TransformersModule> {
  if (!modulePromise) {
    modulePromise = import("@huggingface/transformers").then((mod) => mod as unknown as TransformersModule);
  }
  return modulePromise;
}

export async function loadSegmenter(
  modelId = "Xenova/modnet",
  options: { onProgress?: ModelProgress; onStatus?: (m: string) => void; dtype?: "fp32" | "q8" } = {},
): Promise<Segmenter> {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    const transformers = await loadTransformers();
    options.onStatus?.("Downloading background model…");
    const segmenter = await transformers.pipeline("image-segmentation", modelId, {
      dtype: options.dtype ?? "fp32",
      progress_callback: (event: { file?: string; loaded?: number; total?: number }) => {
        if (!options.onProgress || !event.total) return;
        options.onProgress({
          file: event.file,
          loaded: event.loaded ?? 0,
          total: event.total,
          ratio: (event.loaded ?? 0) / event.total,
        });
      },
    });
    options.onStatus?.("Model ready");
    return segmenter;
  })();
  try {
    return await segmenterPromise;
  } catch (err) {
    segmenterPromise = null;
    throw err;
  }
}

export function isSegmenterLoaded(): boolean {
  return segmenterPromise !== null;
}

/** Draw a video/image source into a canvas at a bounded size. */
export function sourceToCanvas(
  source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number },
  maxSize = 512,
): HTMLCanvasElement {
  const w = source.videoWidth ?? source.naturalWidth ?? 512;
  const h = source.videoHeight ?? source.naturalHeight ?? 512;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export interface Matte {
  /** Alpha values 0..255, one per pixel of the matte canvas. */
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Produce an alpha matte for one frame. `source` may be an HTMLVideoElement or
 * HTMLImageElement; the matte is computed at a reduced size and scaled up by the
 * compositor.
 */
export async function computeMatte(
  source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number },
  options: { maxSize?: number; onStatus?: (m: string) => void } = {},
): Promise<Matte> {
  // fp32 is required: the quantised export produces masks with no channel data.
  const segmenter = await loadSegmenter("Xenova/modnet", { onStatus: options.onStatus, dtype: "fp32" });
  const canvas = sourceToCanvas(source, options.maxSize ?? 384);
  const transformers = await loadTransformers();
  // `new RawImage(canvas)` loses the channel count; the static factory keeps it.
  const image = transformers.RawImage.fromCanvas(canvas);
  options.onStatus?.("Detecting subject…");
  const output = await segmenter(image);

  // The pipeline returns a list of masks; pick the one with the largest area.
  const masks = Array.isArray(output) ? output : [output];
  let best: { data: Uint8Array | Float32Array; dims?: number[] } | null = null;
  for (const mask of masks) {
    const candidate = (mask as unknown as { mask?: { data: Uint8Array | Float32Array; dims?: number[] } }).mask ?? (mask as { data: Uint8Array | Float32Array; dims?: number[] });
    if (!candidate?.data) continue;
    if (!best || candidate.data.length > best.data.length) best = candidate;
  }
  if (!best) throw new Error("The model returned no mask");
  const bestMask = best;

  const dims = bestMask.dims ?? [1, 1, canvas.height, canvas.width];
  const height = dims[dims.length - 2] ?? canvas.height;
  const width = dims[dims.length - 1] ?? canvas.width;
  const alpha = new Uint8ClampedArray(width * height);
  const data = bestMask.data;
  const max = data instanceof Float32Array ? 1 : 255;
  for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round((Number(data[i] ?? 0) / max) * 255);
  return { alpha, width, height };
}

/** Paint a matte as a greyscale canvas for the preview. */
export function matteToCanvas(matte: Matte): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = matte.width;
  canvas.height = matte.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.createImageData(matte.width, matte.height);
  for (let i = 0; i < matte.alpha.length; i++) {
    const v = matte.alpha[i];
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
