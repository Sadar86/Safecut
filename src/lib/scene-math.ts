/**
 * Scene detection maths, kept separate from the DOM so it can be unit tested.
 *
 * Two signals are combined:
 *  - histogram distance: how much the colour distribution changed between
 *    consecutive sampled frames (robust to camera motion);
 *  - mean luminance: used to flag black frames.
 */

export interface SceneFrame {
  time: number;
  /** Average luminance 0..1 of the sampled frame. */
  luma: number;
  /** Normalised 16-bin RGB histogram (48 values). */
  histogram: number[];
}

export interface SceneCut {
  time: number;
  /** 0..1 confidence of the cut. */
  score: number;
}

/** Intersection distance between two normalised histograms (0 = identical). */
export function histogramDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += Math.min(a[i], b[i]);
  return Math.max(0, Math.min(1, 1 - sum));
}

export function isBlackFrame(luma: number, threshold = 0.08): boolean {
  return luma < threshold;
}

/**
 * Detect cuts from a series of sampled frames.
 * A cut is reported when the histogram distance exceeds `threshold`, or when
 * the frame jumps from/to black (fade boundaries).
 */
export function detectCuts(
  frames: SceneFrame[],
  threshold = 0.35,
  blackThreshold = 0.08,
): SceneCut[] {
  const cuts: SceneCut[] = [];
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const cur = frames[i];
    const distance = histogramDistance(prev.histogram, cur.histogram);
    const blackChange = isBlackFrame(prev.luma, blackThreshold) !== isBlackFrame(cur.luma, blackThreshold);
    const score = Math.min(1, distance + (blackChange ? 0.3 : 0));
    if (distance >= threshold || blackChange) {
      cuts.push({ time: cur.time, score });
    }
  }
  return cuts;
}

/** Build a 16-bin-per-channel histogram from RGBA pixel data. */
export function buildHistogram(data: Uint8ClampedArray): { histogram: number[]; luma: number } {
  const bins = new Array(48).fill(0);
  let lumaSum = 0;
  const pixels = Math.floor(data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    bins[Math.min(15, r >> 4)] += 1;
    bins[16 + Math.min(15, g >> 4)] += 1;
    bins[32 + Math.min(15, b >> 4)] += 1;
    lumaSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  if (pixels > 0) for (let i = 0; i < bins.length; i++) bins[i] /= pixels;
  return { histogram: bins, luma: pixels > 0 ? lumaSum / pixels : 0 };
}

/**
 * Merge cuts that are closer together than `minGap` seconds, keeping the one
 * with the highest score. Prevents dozens of cuts inside a flash or a wipe.
 */
export function mergeCuts(cuts: SceneCut[], minGap = 0.4): SceneCut[] {
  const sorted = [...cuts].sort((a, b) => a.time - b.time);
  const merged: SceneCut[] = [];
  for (const cut of sorted) {
    const last = merged[merged.length - 1];
    if (last && cut.time - last.time < minGap) {
      if (cut.score > last.score) merged[merged.length - 1] = cut;
    } else {
      merged.push(cut);
    }
  }
  return merged;
}
