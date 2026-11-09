/**
 * Silence detection shared by the audio studio and the Smart Silence Remover.
 * Works on decoded audio so it matches exactly what the export will contain.
 */

import { detectSilence } from "@/lib/audio-math";

export interface SilenceOptions {
  /** Level below which a window counts as silent (dBFS). */
  thresholdDb: number;
  /** Minimum run length to report (seconds). */
  minDuration: number;
  /** Analysis window (seconds). */
  windowSec: number;
  /** Keep a little audio around speech so cuts do not clip words. */
  padding: number;
}

export const SILENCE_DEFAULTS: SilenceOptions = {
  thresholdDb: -40,
  minDuration: 0.6,
  windowSec: 0.05,
  padding: 0.08,
};

export interface SilenceSegment {
  id: string;
  /** Seconds, relative to the analysed clip's source in-point. */
  start: number;
  end: number;
  /** Peak level inside the segment, for the UI meter. */
  level: number;
}

/** Detect silent segments inside a clip's used source range. */
export function findSilences(
  channel: Float32Array,
  sampleRate: number,
  options: Partial<SilenceOptions> = {},
): SilenceSegment[] {
  const opts = { ...SILENCE_DEFAULTS, ...options };
  const ranges = detectSilence(channel, sampleRate, opts.thresholdDb, opts.minDuration, opts.windowSec);
  return ranges.map((range, i) => ({
    id: `sil_${i}`,
    start: range.start + opts.padding,
    end: Math.max(range.start + opts.padding + 0.05, range.end - opts.padding),
    level: opts.thresholdDb,
  }));
}

export interface RemovalPlan {
  /** Source ranges to delete (seconds, clip-local). */
  ranges: { start: number; end: number }[];
  /** How much shorter the timeline becomes. */
  savedSeconds: number;
  /** Segments that will remain, in order. */
  kept: { start: number; end: number }[];
}

/**
 * Turn approved silent segments into a removal plan.
 * `duration` is the clip length; overlaps are merged and clamped.
 */
export function planRemoval(
  segments: SilenceSegment[],
  duration: number,
  approvedIds?: string[],
): RemovalPlan {
  const approved = segments
    .filter((s) => !approvedIds || approvedIds.includes(s.id))
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(duration, s.end) }))
    .filter((r) => r.end - r.start > 0.01)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const range of approved) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 0.001) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  const kept: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) kept.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < duration) kept.push({ start: cursor, end: duration });

  const savedSeconds = merged.reduce((sum, r) => sum + (r.end - r.start), 0);
  return { ranges: merged, savedSeconds, kept };
}

/**
 * Apply a removal plan to one clip's [start, duration] on the timeline.
 * Returns the surviving pieces as `{ start, inPoint, duration }` blocks laid out
 * back-to-back (or with gaps preserved when `closeGaps` is false).
 */
export function applyRemoval(
  clip: { start: number; duration: number; inPoint: number; speed: number },
  plan: RemovalPlan,
  closeGaps = true,
): { start: number; inPoint: number; duration: number }[] {
  const pieces = plan.kept.map((k) => ({
    inPoint: clip.inPoint + k.start * clip.speed,
    duration: (k.end - k.start) / clip.speed,
    start: clip.start + k.start / clip.speed,
  }));
  if (!closeGaps) return pieces;
  let cursor = clip.start;
  return pieces.map((p) => {
    const moved = { ...p, start: cursor };
    cursor += p.duration;
    return moved;
  });
}
