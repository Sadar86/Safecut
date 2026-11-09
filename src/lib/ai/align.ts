/**
 * Word-level caption alignment.
 *
 * Speech engines return either word timings (Whisper-style) or only phrase
 * timings (Web Speech API). This module turns both into consistent, editable
 * cues and offers the operations the caption editor exposes: merge, split and
 * retime — all pure functions, so they are unit tested.
 */

import type { SubtitleCue } from "@/types";

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  /** Confidence 0..1 when the engine reports it. */
  confidence?: number;
}

export interface AlignOptions {
  /** Longest text per cue before it is wrapped. */
  maxChars?: number;
  /** Cue gap that forces a new cue. */
  maxGap?: number;
  /** Minimum cue duration. */
  minDuration?: number;
  /** Words per cue ceiling (0 = unlimited). */
  maxWords?: number;
}

const DEFAULTS: Required<AlignOptions> = {
  maxChars: 84,
  maxGap: 0.7,
  minDuration: 1.0,
  maxWords: 12,
};

/**
 * Distribute a phrase evenly across its words when the engine only gives a
 * phrase-level timestamp. Longer words get proportionally more time, which
 * tracks speech much better than a flat split.
 */
export function distributeWords(text: string, start: number, end: number): WordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const total = Math.max(0.2, end - start);
  const weights = words.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let cursor = start;
  return words.map((word, i) => {
    const span = (weights[i] / weightSum) * total;
    const timing = { word, start: cursor, end: cursor + span };
    cursor += span;
    return timing;
  });
}

/** Convert word timings into caption cues with readable line breaks. */
export function wordsToCues(words: WordTiming[], options: AlignOptions = {}): SubtitleCue[] {
  const opts = { ...DEFAULTS, ...options };
  const cues: SubtitleCue[] = [];
  let current: { words: WordTiming[]; text: string } | null = null;

  const flush = () => {
    if (!current || current.words.length === 0) return;
    const first = current.words[0];
    const last = current.words[current.words.length - 1];
    cues.push({
      id: `cue_${cues.length}`,
      start: first.start,
      end: Math.max(last.end, first.start + opts.minDuration),
      text: current.text,
    });
    current = null;
  };

  for (const word of words) {
    if (!word.word.trim()) continue;
    if (current) {
      const nextText = `${current.text} ${word.word}`;
      const gap = word.start - current.words[current.words.length - 1].end;
      const tooLong = nextText.length > opts.maxChars;
      const tooMany = opts.maxWords > 0 && current.words.length >= opts.maxWords;
      const bigGap = gap > opts.maxGap;
      if (tooLong || tooMany || bigGap) flush();
    }
    if (!current) current = { words: [word], text: word.word };
    else {
      current.words.push(word);
      current.text = `${current.text} ${word.word}`;
    }
  }
  flush();
  return cues;
}

/** Merge two adjacent cues (the caption editor's "merge" action). */
export function mergeCues(a: SubtitleCue, b: SubtitleCue): SubtitleCue {
  return {
    id: a.id,
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    text: `${a.text.trim()} ${b.text.trim()}`.trim(),
  };
}

/**
 * Split a cue at a time inside it, apportioning the text by word count so both
 * halves keep sensible timing.
 */
export function splitCue(cue: SubtitleCue, at: number): [SubtitleCue, SubtitleCue] | null {
  if (at <= cue.start + 0.05 || at >= cue.end - 0.05) return null;
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return [
      { ...cue, end: at },
      { ...cue, id: `${cue.id}_b`, start: at, text: "" },
    ];
  }
  const ratio = (at - cue.start) / (cue.end - cue.start);
  const cut = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)));
  return [
    { id: cue.id, start: cue.start, end: at, text: words.slice(0, cut).join(" ") },
    { id: `${cue.id}_b`, start: at, end: cue.end, text: words.slice(cut).join(" ") },
  ];
}

/** Move a cue (and optionally its neighbour) to a new start, keeping duration. */
export function retimeCue(cue: SubtitleCue, start: number, end?: number): SubtitleCue {
  const duration = cue.end - cue.start;
  const newStart = Math.max(0, start);
  const newEnd = end ?? newStart + duration;
  return { ...cue, start: newStart, end: Math.max(newStart + 0.1, newEnd) };
}

/** Shift every cue after `from` by `delta` seconds (insert/remove time). */
export function shiftCuesAfter(cues: SubtitleCue[], from: number, delta: number): SubtitleCue[] {
  return cues.map((c) => (c.start >= from ? retimeCue(c, c.start + delta, c.end + delta) : c));
}

/** Keep cues inside a duration and drop the ones fully outside. */
export function clampCues(cues: SubtitleCue[], duration: number): SubtitleCue[] {
  return cues
    .filter((c) => c.end > 0 && c.start < duration)
    .map((c) => ({ ...c, start: Math.max(0, c.start), end: Math.min(duration, c.end) }));
}

/** Estimate confidence of a cue from its words (undefined when unknown). */
export function cueConfidence(words: WordTiming[]): number | undefined {
  const scored = words.filter((w) => typeof w.confidence === "number");
  if (scored.length === 0) return undefined;
  return scored.reduce((sum, w) => sum + (w.confidence ?? 0), 0) / scored.length;
}
