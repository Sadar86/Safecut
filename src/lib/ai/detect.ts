"use client";

/**
 * Face detection for Smart Reframing.
 *
 * Chrome 156/157 no longer expose the old Shape Detection `FaceDetector` API, so
 * SafeCut ships the MediaPipe BlazeFace detector instead: the runtime (wasm) and
 * the 220 KB model are served from the app's own origin by
 * `scripts/setup-models.mjs` and run entirely on the device.
 *
 * When the detector cannot load (no assets, unsupported device), `detectFace`
 * returns null and the reframe panel falls back to manual focus or the
 * motion-based estimate below.
 */

import type { Box } from "@/lib/ai/reframe";

/** Synthesised/illustrated faces are detected less confidently than photos. */
const MIN_FACE_CONFIDENCE = 0.2;

interface Detection {
  boundingBox: { originX: number; originY: number; width: number; height: number };
  categories?: { score: number }[];
}
interface FaceDetectorInstance {
  detect: (image: CanvasImageSource) => { detections: Detection[] };
  close?: () => void;
}
interface FaceDetectorApi {
  createFromOptions: (
    fileset: unknown,
    options: { baseOptions: { modelAssetPath: string; delegate?: string }; runningMode?: string; minDetectionConfidence?: number },
  ) => Promise<FaceDetectorInstance>;
}

let detectorPromise: Promise<FaceDetectorInstance | null> | null = null;

/** Paths are relative so the app works when hosted under a sub-path. */
export const FACE_MODEL_PATH = "/models/blaze_face_short_range.tflite";
export const WASM_BASE = "/models/wasm";

/** Load (once) the MediaPipe face detector, or null when unavailable. */
export async function loadFaceDetector(): Promise<FaceDetectorInstance | null> {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    try {
      const vision = (await import("@mediapipe/tasks-vision")) as unknown as {
        FaceDetector: FaceDetectorApi;
        FilesetResolver: { forVisionTasks: (path: string) => Promise<unknown> };
      };
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
      return await vision.FaceDetector.createFromOptions(fileset, {
        // CPU delegate is 10x faster than GPU for this small model on WASM.
        baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: "CPU" },
        runningMode: "IMAGE",
        minDetectionConfidence: MIN_FACE_CONFIDENCE,
      });
    } catch {
      return null;
    }
  })();
  return detectorPromise;
}

export function faceDetectionSupported(): boolean {
  return typeof window !== "undefined";
}

/** Detect the largest face in a frame as a normalised box. */
export async function detectFace(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<Box | null> {
  const detector = await loadFaceDetector();
  if (!detector) return null;
  const width =
    (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width;
  const height =
    (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height;
  if (!width || !height) return null;
  try {
    const { detections } = detector.detect(source);
    if (detections.length === 0) return null;
    const best = detections
      .map((d) => d.boundingBox)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return {
      x: Math.max(0, best.originX / width),
      y: Math.max(0, best.originY / height),
      w: Math.min(1, best.width / width),
      h: Math.min(1, best.height / height),
    };
  } catch {
    return null;
  }
}

/**
 * Motion-based subject estimate: compare the centre frame with a downscaled
 * luma grid and return the weighted centre of change as a box.
 */
export function estimateSubjectFromFrames(
  frames: { data: Uint8ClampedArray; width: number; height: number }[],
): Box | null {
  if (frames.length < 2) return null;
  const { width, height } = frames[0];
  const cellsX = 16;
  const cellsY = 9;
  const energy = new Float32Array(cellsX * cellsY);
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1].data;
    const b = frames[f].data;
    for (let y = 0; y < height; y++) {
      const cy = Math.min(cellsY - 1, Math.floor((y / height) * cellsY));
      for (let x = 0; x < width; x++) {
        const cx = Math.min(cellsX - 1, Math.floor((x / width) * cellsX));
        const i = (y * width + x) * 4;
        const la = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
        const lb = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
        energy[cy * cellsX + cx] += Math.abs(la - lb);
      }
    }
  }
  let total = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < cellsY; y++) {
    for (let x = 0; x < cellsX; x++) {
      const e = energy[y * cellsX + x];
      total += e;
      sx += e * (x + 0.5);
      sy += e * (y + 0.5);
    }
  }
  if (total <= 0) return null;
  const cx = sx / total / cellsX;
  const cy = sy / total / cellsY;
  const w = 0.45;
  const h = 0.55;
  return {
    x: Math.max(0, Math.min(1 - w, cx - w / 2)),
    y: Math.max(0, Math.min(1 - h, cy - h / 2)),
    w,
    h,
  };
}
