/**
 * Caption templates and the conversion from subtitle cues to timeline clips.
 * Pure functions so the whole pipeline is unit tested without a browser.
 */

import type { Clip, Project, SubtitleCue, TextStyle } from "@/types";
import { DEFAULT_TEXT } from "@/types";
import { makeClip } from "@/lib/timeline";
import { toWordCues } from "@/lib/subtitles";

export interface CaptionTemplate {
  id: string;
  name: string;
  description: string;
  /** Swatch used by the caption panel. */
  swatch: { background: string; color: string };
  style: Partial<TextStyle>;
  /** Emit one clip per word (karaoke / word-by-word captions). */
  wordByWord?: boolean;
}

export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  {
    id: "clean",
    name: "Clean",
    description: "White text with a soft shadow, bottom centre.",
    swatch: { background: "#1f2937", color: "#ffffff" },
    style: { fontSize: 46, bold: true, color: "#ffffff", background: "transparent", y: 86, shadow: true, animation: "fade", maxWordsPerLine: 6 },
  },
  {
    id: "boxed",
    name: "Boxed",
    description: "Dark rounded box behind every caption.",
    swatch: { background: "#000000", color: "#ffffff" },
    style: { fontSize: 44, bold: true, background: "rgba(0,0,0,0.72)", y: 84, shadow: false, animation: "fade", maxWordsPerLine: 5 },
  },
  {
    id: "highlight",
    name: "Highlight word",
    description: "Karaoke highlight that follows the spoken word.",
    swatch: { background: "#f59e0b", color: "#111827" },
    style: { fontSize: 52, bold: true, background: "transparent", y: 82, animation: "word", highlightColor: "#fbbf24", maxWordsPerLine: 4 },
    wordByWord: false,
  },
  {
    id: "tiktok",
    name: "TikTok word-by-word",
    description: "One bold word at a time, centred — short-form style.",
    swatch: { background: "#22d3ee", color: "#0f172a" },
    style: { fontSize: 78, bold: true, background: "transparent", outlineColor: "#000000", outlineWidth: 4, y: 55, animation: "pop", maxWordsPerLine: 1 },
    wordByWord: true,
  },
  {
    id: "lowerthird",
    name: "Lower third",
    description: "Left-aligned caption with a dark bar.",
    swatch: { background: "#111827", color: "#e5e7eb" },
    style: { fontSize: 40, bold: false, align: "left", x: 30, y: 78, background: "rgba(17,24,39,0.78)", animation: "slide-up", maxWordsPerLine: 8 },
  },
  {
    id: "news",
    name: "News ticker",
    description: "Wide bar at the bottom, uppercase feel.",
    swatch: { background: "#b91c1c", color: "#ffffff" },
    style: { fontSize: 38, bold: true, background: "rgba(185,28,28,0.9)", y: 92, animation: "fade", maxWordsPerLine: 9 },
  },
];

export function templateById(id: string): CaptionTemplate {
  return CAPTION_TEMPLATES.find((t) => t.id === id) ?? CAPTION_TEMPLATES[0];
}

/** Merge a template with the current text style (template wins). */
export function styleForTemplate(template: CaptionTemplate, base?: Partial<TextStyle>): TextStyle {
  return { ...DEFAULT_TEXT, ...base, ...template.style, template: template.id };
}

/**
 * Build caption clips on a text track from subtitle cues.
 * Each clip's `start` is the cue start plus `offset`.
 */
export function cuesToClips(
  cues: SubtitleCue[],
  trackId: string,
  template: CaptionTemplate,
  options: { offset?: number; baseStyle?: Partial<TextStyle> } = {},
): Clip[] {
  const offset = options.offset ?? 0;
  const style = styleForTemplate(template, options.baseStyle);
  const expanded = template.wordByWord ? cues.flatMap((cue) => toWordCues(cue)) : cues;
  return expanded.map((cue) => {
    const start = Math.max(0, cue.start + offset);
    const duration = Math.max(0.2, cue.end - cue.start);
    const clip = makeClip({
      trackId,
      mediaId: null,
      name: cue.text.slice(0, 40),
      start,
      duration,
      sourceDuration: duration,
    });
    return { ...clip, text: { ...style, content: cue.text } };
  });
}

/** The inverse: rebuild cues from caption clips (for SRT/VTT export). */
export function clipsToCues(clips: Clip[]): SubtitleCue[] {
  return clips
    .filter((c) => c.text)
    .sort((a, b) => a.start - b.start)
    .map((c) => ({
      id: c.id,
      start: c.start,
      end: c.start + c.duration,
      text: c.text!.content,
    }));
}

/** Find or create the dedicated caption track of a project. */
export function captionTrack(project: Project): { project: Project; trackId: string } {
  const existing = project.tracks.find((t) => t.kind === "text" && t.name.toLowerCase().includes("caption"));
  if (existing) return { project, trackId: existing.id };
  const trackId = `trk_captions_${Math.random().toString(36).slice(2, 8)}`;
  const project2: Project = {
    ...project,
    tracks: [
      ...project.tracks,
      {
        id: trackId,
        kind: "text",
        name: "Captions",
        muted: false,
        locked: false,
        hidden: false,
        volume: 1,
        index: project.tracks.length,
      },
    ],
  };
  return { project: project2, trackId };
}
