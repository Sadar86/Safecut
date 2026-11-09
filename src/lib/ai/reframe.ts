/**
 * Smart reframing: keep the subject inside a new aspect ratio.
 *
 * `cropFor` maps a normalised subject box (0..1 of the source frame) plus a
 * target aspect ratio onto a crop rectangle. `smoothPath` turns per-sample
 * subject positions into a steady camera path so the crop does not jitter.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  width: number;
  height: number;
}

export type ReframeMode = "center" | "subject" | "manual";

export const ASPECT_TARGETS: Record<string, { label: string; ratio: number; size: Size }> = {
  "9:16": { label: "Vertical 9:16", ratio: 9 / 16, size: { width: 1080, height: 1920 } },
  "1:1": { label: "Square 1:1", ratio: 1, size: { width: 1080, height: 1080 } },
  "4:5": { label: "Portrait 4:5", ratio: 4 / 5, size: { width: 1080, height: 1350 } },
  "16:9": { label: "Landscape 16:9", ratio: 16 / 9, size: { width: 1920, height: 1080 } },
  "21:9": { label: "Cinema 21:9", ratio: 21 / 9, size: { width: 2560, height: 1080 } },
};

export function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Crop rectangle (in source pixels) that fills the target ratio and contains the
 * subject box. `focus` is the normalised point the crop should centre on.
 */
export function cropFor(
  source: Size,
  targetRatio: number,
  focus: { x: number; y: number } = { x: 0.5, y: 0.5 },
  subject?: Box | null,
): Box {
  const srcRatio = source.width / source.height;
  let w: number;
  let h: number;
  if (srcRatio > targetRatio) {
    // Source is wider: crop the sides.
    h = source.height;
    w = h * targetRatio;
  } else {
    w = source.width;
    h = w / targetRatio;
  }

  // Keep the whole subject inside the crop when we know where it is.
  let cx = clamp01(focus.x);
  let cy = clamp01(focus.y);
  if (subject) {
    const subCx = subject.x + subject.w / 2;
    const subCy = subject.y + subject.h / 2;
    cx = clamp01(subCx);
    cy = clamp01(subCy);
    // If the subject is wider/taller than the crop, favour the top of it (faces
    // are usually in the upper half).
    const subW = subject.w * source.width;
    const subH = subject.h * source.height;
    if (subW > w) cx = clamp01(subject.x + (subject.w * w) / 2 / source.width / (subject.w || 1)) || cx;
    if (subH > h) cy = clamp01(subject.y + 0.25 * subject.h);
  }

  // Round the size first, then clamp the offset so the box can never leave the
  // source frame (rounding both independently used to overshoot by a pixel).
  const roundedW = Math.min(source.width, Math.round(w));
  const roundedH = Math.min(source.height, Math.round(h));
  const x = Math.max(0, Math.min(source.width - roundedW, cx * source.width - roundedW / 2));
  const y = Math.max(0, Math.min(source.height - roundedH, cy * source.height - roundedH / 2));
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: roundedW,
    h: roundedH,
  };
}

/** Convert a crop rectangle into the renderer's scale/position transform. */
export function cropToTransform(crop: Box, source: Size) {
  const scale = source.width / crop.w;
  const centerX = crop.x + crop.w / 2;
  const centerY = crop.y + crop.h / 2;
  return {
    scale,
    x: ((source.width / 2 - centerX) / source.width) * 100,
    y: ((source.height / 2 - centerY) / source.height) * 100,
  };
}

/**
 * Median filter + moving average over a series of focus points, so the crop
 * follows the subject smoothly instead of snapping between detections.
 */
export function smoothPath(
  points: { x: number; y: number }[],
  windowSize = 5,
): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const medianFiltered = points.map((_, i) => {
    const from = Math.max(0, i - Math.floor(windowSize / 2));
    const to = Math.min(points.length, i + Math.floor(windowSize / 2) + 1);
    return {
      x: median(points.slice(from, to).map((p) => p.x)),
      y: median(points.slice(from, to).map((p) => p.y)),
    };
  });
  return medianFiltered.map((_, i) => {
    const from = Math.max(0, i - Math.floor(windowSize / 2));
    const to = Math.min(medianFiltered.length, i + Math.floor(windowSize / 2) + 1);
    const slice = medianFiltered.slice(from, to);
    return {
      x: slice.reduce((a, p) => a + p.x, 0) / slice.length,
      y: slice.reduce((a, p) => a + p.y, 0) / slice.length,
    };
  });
}

/** Describe a crop as a percentage offset for manual adjustment in the UI. */
export function describeCrop(crop: Box, source: Size) {
  return {
    horizontal: Math.round((crop.x / Math.max(1, source.width - crop.w)) * 100),
    vertical: Math.round((crop.y / Math.max(1, source.height - crop.h)) * 100),
    coverage: Math.round(((crop.w * crop.h) / (source.width * source.height)) * 100),
  };
}
