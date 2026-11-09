"use client";

/**
 * Subject detection for Smart Reframing.
 *
 * Face detection uses the browser's Shape Detection API (Chrome/Edge, on-device).
 * When it is unavailable we fall back to a motion/energy centre-of-mass estimate
 * computed from sampled frames, which works for most talking-head and action
 * footage. Both paths return normalised boxes, so the crop maths is identical.
 */

import type { Box } from "@/lib/ai/reframe";

interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}
interface FaceDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedFace[]>;
}
type FaceDetectorCtor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;

export function faceDetectionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { FaceDetector?: FaceDetectorCtor };
  return typeof w.FaceDetector === "function";
}

/** Detect the most prominent face in a frame as a normalised box. */
export async function detectFace(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<Box | null> {
  if (!faceDetectionSupported()) return null;
  const w = window as unknown as { FaceDetector: FaceDetectorCtor };
  try {
    const detector = new w.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
    const faces = await detector.detect(source);
    if (faces.length === 0) return null;
    const width = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width;
    const height = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height;
    const best = faces
      .map((f) => f.boundingBox)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return {
      x: best.x / width,
      y: best.y / height,
      w: best.width / width,
      h: best.height / height,
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
