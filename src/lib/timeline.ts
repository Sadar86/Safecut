import type {
  Clip,
  ColorAdjustments,
  Keyframe,
  KeyframeProperty,
  Project,
  ProjectSettings,
  Track,
  TrackKind,
} from "@/types";
import { DEFAULT_AUDIO, DEFAULT_COLOR, DEFAULT_TRANSFORM } from "@/types";
import { clamp, uid } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Project construction                                                       */
/* -------------------------------------------------------------------------- */

export const TRACK_ORDER: TrackKind[] = ["video", "overlay", "text", "audio"];

export function createTrack(kind: TrackKind, name: string, index = 0): Track {
  return {
    id: uid("trk"),
    kind,
    name,
    muted: false,
    locked: false,
    hidden: false,
    volume: 1,
    index,
  } as Track;
}

export function createProject(
  name = "Untitled project",
  settings?: Partial<ProjectSettings>,
): Project {
  const now = Date.now();
  return {
    id: uid("prj"),
    name,
    createdAt: now,
    updatedAt: now,
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      aspectRatio: "16:9",
      background: "#000000",
      ...settings,
    },
    assets: [],
    tracks: [
      createTrack("video", "Video 1", 0),
      createTrack("overlay", "Overlay 1", 1),
      createTrack("text", "Text 1", 2),
      createTrack("audio", "Audio 1", 3),
    ],
    clips: [],
    duration: 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  Timeline maths                                                             */
/* -------------------------------------------------------------------------- */

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function projectDuration(clips: Clip[]): number {
  return clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/** Effective on-screen duration for a source span at a given speed. */
export function sourceSpanDuration(sourceDuration: number, speed: number): number {
  return sourceDuration / Math.max(0.05, speed);
}

export function clipsOnTrack(clips: Clip[], trackId: string): Clip[] {
  return clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

/** Find a gap on a track that fits `duration`, starting the search at `from`. */
export function findGap(clips: Clip[], trackId: string, duration: number, from = 0): number {
  const sorted = clipsOnTrack(clips, trackId);
  let cursor = from;
  for (const c of sorted) {
    if (clipEnd(c) <= cursor) continue;
    if (c.start - cursor >= duration) return cursor;
    cursor = Math.max(cursor, clipEnd(c));
  }
  return cursor;
}

/** True when [start, start+duration) overlaps any clip on the track. */
export function overlaps(
  clips: Clip[],
  trackId: string,
  start: number,
  duration: number,
  ignoreIds: string[] = [],
): boolean {
  const end = start + duration;
  return clips.some(
    (c) =>
      c.trackId === trackId &&
      !ignoreIds.includes(c.id) &&
      start < clipEnd(c) - 1e-6 &&
      end > c.start + 1e-6,
  );
}

/* -------------------------------------------------------------------------- */
/*  Editing operations (pure: return the next clip array)                      */
/* -------------------------------------------------------------------------- */

export function splitClip(clips: Clip[], clipId: string, atTime: number): Clip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return clips;
  const offset = atTime - clip.start;
  if (offset <= 0.01 || offset >= clip.duration - 0.01) return clips;

  const left: Clip = { ...clip, duration: offset, keyframes: [] };
  const right: Clip = {
    ...clip,
    id: uid("clp"),
    start: atTime,
    duration: clip.duration - offset,
    inPoint: clip.inPoint + offset * clip.speed,
    keyframes: [],
  };
  // Keyframes belong to whichever half contains them.
  for (const k of clip.keyframes) {
    if (k.t < offset) left.keyframes.push({ ...k });
    else right.keyframes.push({ ...k, t: k.t - offset });
  }
  return clips.flatMap((c) => (c.id === clipId ? [left, right] : [c]));
}

export function trimClip(
  clips: Clip[],
  clipId: string,
  edge: "start" | "end",
  time: number,
): Clip[] {
  return clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    if (edge === "start") {
      const maxStart = clipEnd(clip) - 0.05;
      const sourceLimit = clip.start - clip.inPoint / clip.speed;
      const newStart = clamp(time, Math.max(0, sourceLimit), maxStart);
      const delta = newStart - clip.start;
      return {
        ...clip,
        start: newStart,
        duration: clip.duration - delta,
        inPoint: clip.inPoint + delta * clip.speed,
      };
    }
    const newEnd = Math.max(clip.start + 0.05, time);
    return { ...clip, duration: newEnd - clip.start };
  });
}

export function moveClip(
  clips: Clip[],
  clipId: string,
  trackId: string,
  start: number,
): Clip[] {
  return clips.map((c) =>
    c.id === clipId ? { ...c, trackId, start: Math.max(0, start) } : c,
  );
}

export function deleteClips(clips: Clip[], ids: string[]): Clip[] {
  return clips.filter((c) => !ids.includes(c.id));
}

export function duplicateClip(clips: Clip[], clipId: string): Clip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return clips;
  const start = findGap(clips, clip.trackId, clip.duration, clipEnd(clip));
  return [...clips, { ...structuredClone(clip), id: uid("clp"), start }];
}

export function patchClip(clips: Clip[], clipId: string, patch: Partial<Clip>): Clip[] {
  return clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c));
}

export function setColor(
  clips: Clip[],
  clipId: string,
  patch: Partial<ColorAdjustments>,
): Clip[] {
  return clips.map((c) =>
    c.id === clipId ? { ...c, color: { ...DEFAULT_COLOR, ...c.color, ...patch } } : c,
  );
}

/* -------------------------------------------------------------------------- */
/*  Keyframes                                                                  */
/* -------------------------------------------------------------------------- */

export function addKeyframe(
  clip: Clip,
  property: KeyframeProperty,
  t: number,
  value: number,
): Clip {
  const keyframes = clip.keyframes.filter(
    (k) => !(k.property === property && Math.abs(k.t - t) < 1e-3),
  );
  keyframes.push({ t: clamp(t, 0, clip.duration), property, value });
  keyframes.sort((a, b) => a.t - b.t);
  return { ...clip, keyframes };
}

/**
 * Linear interpolation between the surrounding keyframes of one property.
 * Returns `fallback` when the property has no keyframes at all.
 */
export function evaluateKeyframes(
  keyframes: Keyframe[],
  property: KeyframeProperty,
  t: number,
  fallback: number,
): number {
  const frames = keyframes.filter((k) => k.property === property).sort((a, b) => a.t - b.t);
  if (frames.length === 0) return fallback;
  if (t <= frames[0].t) return frames[0].value;
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1].value;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1;
      const p = (t - a.t) / span;
      return a.value + (b.value - a.value) * p;
    }
  }
  return fallback;
}

/* -------------------------------------------------------------------------- */
/*  Clip factories                                                             */
/* -------------------------------------------------------------------------- */

export function makeClip(params: {
  trackId: string;
  mediaId: string | null;
  name: string;
  start: number;
  duration: number;
  sourceDuration: number;
  inPoint?: number;
}): Clip {
  return {
    id: uid("clp"),
    trackId: params.trackId,
    mediaId: params.mediaId,
    name: params.name,
    start: Math.max(0, params.start),
    duration: Math.max(0.05, params.duration),
    inPoint: params.inPoint ?? 0,
    sourceDuration: params.sourceDuration,
    speed: 1,
    reversed: false,
    color: { ...DEFAULT_COLOR },
    filter: "none",
    transform: { ...DEFAULT_TRANSFORM },
    audio: { ...DEFAULT_AUDIO, eq: { ...DEFAULT_AUDIO.eq } },
    transitionIn: "none",
    transitionOut: "none",
    transitionDuration: 0.5,
    keyframes: [],
  };
}
