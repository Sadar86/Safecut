/**
 * Automatic highlight detection.
 *
 * Combines two cheap, local signals per scene:
 *  - motion: how much the frame changes (histogram distance between samples);
 *  - loudness: audio energy relative to the clip average.
 * Scenes are then scored, ranked and grouped into highlight segments. Nothing
 * is removed from the timeline: the user reviews the suggestions.
 */

export interface HighlightSample {
  /** Seconds from the start of the analysed clip. */
  time: number;
  /** 0..1 frame-change score. */
  motion: number;
  /** 0..1 audio energy for the window starting at `time`. */
  loudness: number;
}

export interface HighlightSegment {
  id: string;
  start: number;
  end: number;
  score: number;
  reasons: string[];
}

export interface HighlightOptions {
  /** How many segments to return. */
  count: number;
  /** Minimum segment length (seconds). */
  minDuration: number;
  /** Maximum segment length (seconds). */
  maxDuration: number;
  /** Weight of motion vs loudness (0..1, default 0.5). */
  motionWeight: number;
}

export const HIGHLIGHT_DEFAULTS: HighlightOptions = {
  count: 3,
  minDuration: 6,
  maxDuration: 20,
  motionWeight: 0.5,
};

/** Normalise a numeric series to 0..1 (returns zeros for a flat series). */
export function normalise(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  if (span < 1e-6) return values.map(() => 0);
  return values.map((v) => (v - min) / span);
}

/** Score each sample window; higher means "more interesting". */
export function scoreSamples(
  samples: HighlightSample[],
  motionWeight = HIGHLIGHT_DEFAULTS.motionWeight,
): number[] {
  const motion = normalise(samples.map((s) => s.motion));
  const loud = normalise(samples.map((s) => s.loudness));
  const w = Math.max(0, Math.min(1, motionWeight));
  return samples.map((_, i) => motion[i] * w + loud[i] * (1 - w));
}

/**
 * Slide a window over the scored samples and keep the best non-overlapping
 * windows. `windowSec` is how much timeline a segment covers.
 */
export function findHighlights(
  samples: HighlightSample[],
  clipDuration: number,
  options: Partial<HighlightOptions> = {},
): HighlightSegment[] {
  const opts = { ...HIGHLIGHT_DEFAULTS, ...options };
  if (samples.length === 0 || clipDuration <= 0) return [];
  const scores = scoreSamples(samples, opts.motionWeight);
  const step = samples.length > 1 ? samples[1].time - samples[0].time : 1;
  const windowSamples = Math.max(1, Math.round(Math.min(opts.maxDuration, clipDuration) / step));

  const candidates: { startIndex: number; score: number }[] = [];
  for (let i = 0; i + 1 < scores.length; i++) {
    const slice = scores.slice(i, i + windowSamples);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    candidates.push({ startIndex: i, score: avg });
  }
  candidates.sort((a, b) => b.score - a.score);

  const chosen: HighlightSegment[] = [];
  const taken: { start: number; end: number }[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= opts.count) break;
    const start = samples[candidate.startIndex].time;
    const end = Math.min(clipDuration, start + windowSamples * step);
    if (end - start < opts.minDuration) continue;
    if (taken.some((t) => start < t.end && end > t.start)) continue;
    taken.push({ start, end });

    const slice = samples.slice(candidate.startIndex, candidate.startIndex + windowSamples);
    const motion = slice.reduce((a, b) => a + b.motion, 0) / slice.length;
    const loudness = slice.reduce((a, b) => a + b.loudness, 0) / slice.length;
    const reasons: string[] = [];
    if (motion > 0.55) reasons.push("fast-moving visuals");
    if (loudness > 0.6) reasons.push("loud, energetic audio");
    if (reasons.length === 0) reasons.push("above-average activity");

    chosen.push({
      id: `hl_${chosen.length}`,
      start,
      end,
      score: candidate.score,
      reasons,
    });
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/** Total length of the selected highlights. */
export function highlightsDuration(segments: HighlightSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0);
}
