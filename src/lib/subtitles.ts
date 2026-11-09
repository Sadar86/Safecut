/**
 * Subtitle parsing and serialisation.
 *
 * Supports SubRip (`.srt`) and WebVTT (`.vtt`) in both directions, plus the
 * plain-text transcript export used by the caption editor. Times are seconds.
 */

export interface SubtitleCue {
  id: string;
  /** Seconds from the start of the media. */
  start: number;
  end: number;
  text: string;
}

let counter = 0;
function cueId(): string {
  counter += 1;
  return `cue_${Date.now().toString(36)}_${counter}`;
}

/** `00:01:02,500` or `01:02.500` → 62.5 */
export function parseTimestamp(raw: string): number {
  const cleaned = raw.trim().replace(",", ".");
  const parts = cleaned.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return NaN;
}

/** 62.5 → `00:01:02,500` (SRT) or `00:01:02.500` (VTT). */
export function formatTimestamp(seconds: number, separator: "," | "." = ","): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms, 3)}`;
}

const TIMING_LINE = /^\s*(-?[\d:.,]+)\s*-->\s*(-?[\d:.,]+)/;

/** Parse an SRT or VTT document into cues (sorted, with empty cues dropped). */
export function parseSubtitles(input: string): SubtitleCue[] {
  const text = input.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const lines = text.split("\n");
  const cues: SubtitleCue[] = [];
  let i = 0;

  // Skip the WEBVTT header and any NOTE/STYLE blocks.
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("WEBVTT") || line.startsWith("NOTE") || line.startsWith("STYLE") || line === "") {
      i++;
      continue;
    }
    break;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Optional numeric/identifier line before the timing line.
    if (!TIMING_LINE.test(line) && i + 1 < lines.length && TIMING_LINE.test(lines[i + 1])) {
      i++;
    }
    const timing = lines[i]?.match(TIMING_LINE);
    if (!timing) {
      i++;
      continue;
    }
    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i].replace(/<[^>]+>/g, ""));
      i++;
    }
    const content = textLines.join("\n").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && content) {
      cues.push({ id: cueId(), start, end: Math.max(end, start + 0.1), text: content });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function toSRT(cues: SubtitleCue[]): string {
  return cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.start, ",")} --> ${formatTimestamp(c.end, ",")}\n${c.text}\n`)
    .join("\n");
}

export function toVTT(cues: SubtitleCue[]): string {
  const body = cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((c) => `${formatTimestamp(c.start, ".")} --> ${formatTimestamp(c.end, ".")}\n${c.text}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export function toTranscript(cues: SubtitleCue[]): string {
  return cues.map((c) => c.text.replace(/\n/g, " ")).join("\n");
}

/**
 * Split a cue into word-level cues spread evenly across its duration.
 * Used for word-by-word and karaoke captions.
 */
export function toWordCues(cue: SubtitleCue): SubtitleCue[] {
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [{ ...cue }];
  const span = (cue.end - cue.start) / words.length;
  return words.map((word, i) => ({
    id: `${cue.id}_w${i}`,
    start: cue.start + i * span,
    end: cue.start + (i + 1) * span,
    text: word,
  }));
}

/** Shift every cue by `offset` seconds and clamp at zero. */
export function shiftCues(cues: SubtitleCue[], offset: number): SubtitleCue[] {
  return cues.map((c) => ({
    ...c,
    start: Math.max(0, c.start + offset),
    end: Math.max(0.1, c.end + offset),
  }));
}

/** Total spoken duration, useful for tests and the caption panel summary. */
export function cuesDuration(cues: SubtitleCue[]): number {
  return cues.reduce((max, c) => Math.max(max, c.end), 0);
}
